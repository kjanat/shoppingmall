import * as THREE from 'three';
import { levelAt } from '#/data/levels';
import { type BatchMode, batchMode } from '#/render/graphicsPrefs';
import { span } from '#/util/math';

type ColorMaterial = THREE.Material & { color?: THREE.Color };
type SourceInstance = {
	mesh: THREE.Mesh<THREE.BufferGeometry, ColorMaterial>;
	instanceId: number;
	geometryId: number;
	/**
	 * The values this instance was last given. Every setter on a BatchedMesh marks
	 * one of its data textures dirty and a dirty texture is re-uploaded whole on
	 * the next render, so the batch is only told about a value that changed.
	 */
	matrix: THREE.Matrix4;
	color: THREE.Vector4;
	visible: boolean;
	streak: number;
};

type Batch = { mesh: THREE.BatchedMesh; sources: SourceInstance[]; dynamicRoot: THREE.Object3D | null };

export type SceneBatchStats = {
	mode: BatchMode;
	sourceMeshes: number;
	dynamicSources: number;
	batchedMeshes: number;
	drawCalls: number;
	largestRadius: number;
	owners: readonly BatchOwnerStats[];
};

export type BatchOwnerStats = {
	name: string;
	dynamic: boolean;
	sources: number;
	batches: number;
	triangles: number;
	largestRadius: number;
};

/** A cell is wide enough to avoid turning every shop into its own draw call,
 * while keeping shared wall and floor materials out of a mall-wide sphere. */
const CELL_SIZE = 32;
/** Small compatible groups gain nothing from being split into mostly singles. */
const MIN_SPATIAL_GROUP = 12;
const STATIC_STREAK = 60;
const COLD_SHARDS = 8;

const WHITE = new THREE.Color(0xffffff);
const INSTANCE_COLOR = new THREE.Vector4(1, 1, 1, 1);
const MOVED_SPHERE = new THREE.Sphere();

/**
 * A moved instance leaves the batch's lazily-computed union bounding sphere
 * stale, because setMatrixAt never invalidates it, so grow the sphere over the
 * new position. Growing is monotonic and can never under-cover; the batch keeps
 * its frustum test at the cost of a sphere spanning the mover's travel
 * envelope. Demoting the whole batch to frustumCulled=false was tried first
 * and lost the two biggest batches (70% of all instances) within seconds,
 * because the shared-material keys that make a batch big are exactly what pull
 * in every animated limb. A null sphere needs nothing: the lazy compute reads
 * the matrices as they are now.
 */
function growBounds(mesh: THREE.BatchedMesh, source: SourceInstance): void {
	const sphere = mesh.boundingSphere;
	if (!sphere) return;
	// null only for an unknown geometryId, which addInstance guaranteed exists
	const moved = mesh.getBoundingSphereAt(source.geometryId, MOVED_SPHERE);
	if (moved) sphere.union(moved.applyMatrix4(source.matrix));
}

function instanceColor(material: ColorMaterial): THREE.Vector4 {
	const color = material.color ?? WHITE;
	return INSTANCE_COLOR.set(color.r, color.g, color.b, material.opacity);
}

function geometryTriangles(geometry: THREE.BufferGeometry): number {
	return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

function materialKey(material: ColorMaterial): string {
	// Only include properties that alter the shader program or cannot be carried
	// per instance. Hundreds of scene materials differ only by UUID, base color
	// or an invisible emissive tint; those differences should not create draw calls.
	const props = material as unknown as Record<string, unknown>;
	const texture = (name: string): string => {
		const value = props[name];
		return value instanceof THREE.Texture ? value.uuid : '';
	};
	const number = (name: string, fallback = 0): number => {
		const value = props[name];
		return typeof value === 'number' ? value : fallback;
	};
	const quantize = (name: string): number => Math.round(number(name) * 4) / 4;
	// Emissive splits a batch only when it is visible. The exact hex once split 71
	// of 141 batches: StockDisplay tints every product's emissive with its own
	// colour at intensity 0.08, which is invisible, so an emissive whose quantized
	// intensity rounds to zero collapses freely. Anything brighter keeps its exact
	// colour: an earlier quarter-step-per-channel scheme quantized in LINEAR space,
	// where every dark tone lands in the same bucket, and the beard cave's amber
	// gold (#664400 @0.2) batched with the elevator's dark red frame (#8b0000
	// @0.35), so the whole hoard rendered with a red cast, picked by traversal order.
	const emissive = props['emissive'];
	const emissiveKey = emissive instanceof THREE.Color && quantize('emissiveIntensity') > 0 ? emissive.getHexString() : '';

	return JSON.stringify({
		type: material.type,
		maps: [
			'map',
			'alphaMap',
			'aoMap',
			'bumpMap',
			'displacementMap',
			'emissiveMap',
			'envMap',
			'lightMap',
			'metalnessMap',
			'normalMap',
			'roughnessMap',
		].map(texture),
		side: material.side,
		blending: material.blending,
		depthFunc: material.depthFunc,
		depthWrite: material.depthWrite,
		depthTest: material.depthTest,
		transparent: material.transparent,
		alphaTest: material.alphaTest,
		vertexColors: material.vertexColors,
		fog: props['fog'] === true,
		toneMapped: material.toneMapped,
		flatShading: props['flatShading'] === true,
		wireframe: props['wireframe'] === true,
		// Back in the key with MeshStandardMaterial: they change how a surface
		// shades, so a matte wall and polished steel must not share a batch.
		// Quantized to quarter steps, since hundreds of materials differ only by a
		// hair, and those differences should not each cost a draw call.
		roughness: quantize('roughness'),
		metalness: quantize('metalness'),
		emissive: emissiveKey,
		emissiveIntensity: quantize('emissiveIntensity'),
		normalScale: String(props['normalScale'] ?? ''),
		bumpScale: number('bumpScale', 1),
		displacementScale: number('displacementScale', 1),
	});
}

function geometryLayoutKey(geometry: THREE.BufferGeometry): string {
	const attributes = Object.entries(geometry.attributes)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, attribute]) => {
			const array = attribute.array as ArrayLike<number> & { constructor: { name: string } };
			return `${name}:${attribute.itemSize}:${attribute.normalized}:${array.constructor.name}`;
		})
		.join('|');
	const index = geometry.index;
	const indexType = index ? (index.array as { constructor: { name: string } }).constructor.name : 'none';
	return `${indexType}|${attributes}`;
}

function isVisible(object: THREE.Object3D): boolean {
	for (let current: THREE.Object3D | null = object; current; current = current.parent) {
		if (!current.visible) return false;
	}
	return true;
}

/**
 * Replaces compatible opaque meshes with dynamic BatchedMeshes. The original
 * hierarchy remains alive for gameplay and animation; only its render layer is
 * disabled. Transform, visibility and color are copied before each render.
 */
export class SceneBatcher {
	readonly stats: SceneBatchStats;
	private readonly batches: Batch[] = [];
	private readonly dynamicRoots: THREE.Object3D[];
	private shard = 0;

	constructor(scene: THREE.Scene, dynamicRoots: readonly THREE.Object3D[] = []) {
		const mode = batchMode();
		// Build-time is the one full hierarchy pass. From the first live frame on,
		// only explicitly animated roots are refreshed.
		scene.updateMatrixWorld(true);
		const ownerByObject = new WeakMap<THREE.Object3D, THREE.Object3D>();
		const rootSet = new Set(dynamicRoots);
		this.dynamicRoots = dynamicRoots.filter((root) => {
			for (let parent = root.parent; parent; parent = parent.parent) {
				if (rootSet.has(parent)) return false;
			}
			return true;
		});
		for (const root of this.dynamicRoots) root.traverse((object) => ownerByObject.set(object, root));

		type CompatibleGroup = {
			dynamicRoot: THREE.Object3D | null;
			meshes: THREE.Mesh<THREE.BufferGeometry, ColorMaterial>[];
		};
		const compatible = new Map<string, CompatibleGroup>();

		scene.traverse((object) => {
			if (!(object instanceof THREE.Mesh) || object instanceof THREE.BatchedMesh || object instanceof THREE.InstancedMesh) {
				return;
			}
			if (object instanceof THREE.SkinnedMesh || Array.isArray(object.material)) return;
			if (Object.keys(object.geometry.morphAttributes).length > 0) return;

			const material = object.material as ColorMaterial;
			const dynamicRoot = ownerByObject.get(object) ?? null;
			const key = [
				materialKey(material),
				geometryLayoutKey(object.geometry),
				object.castShadow ? 'cast' : '',
				object.receiveShadow ? 'receive' : '',
				String(object.renderOrder),
				dynamicRoot?.uuid ?? 'static',
			].join('::');
			const group = compatible.get(key);
			if (group) group.meshes.push(object as THREE.Mesh<THREE.BufferGeometry, ColorMaterial>);
			else compatible.set(key, { dynamicRoot, meshes: [object as THREE.Mesh<THREE.BufferGeometry, ColorMaterial>] });
		});

		let sourceMeshes = 0;
		let dynamicSources = 0;
		let largestRadius = 0;
		const ownerStats = new Map<string, BatchOwnerStats>();
		const groups: CompatibleGroup[] = [];
		for (const group of compatible.values()) {
			let minX = Number.POSITIVE_INFINITY;
			let maxX = Number.NEGATIVE_INFINITY;
			let minZ = Number.POSITIVE_INFINITY;
			let maxZ = Number.NEGATIVE_INFINITY;
			for (const mesh of group.meshes) {
				const x = mesh.matrixWorld.elements[12] ?? 0;
				const z = mesh.matrixWorld.elements[14] ?? 0;
				minX = Math.min(minX, x);
				maxX = Math.max(maxX, x);
				minZ = Math.min(minZ, z);
				maxZ = Math.max(maxZ, z);
			}
			const geographicallyLocal = span(minX, maxX) <= CELL_SIZE && span(minZ, maxZ) <= CELL_SIZE;
			if (
				mode === 'global' ||
				// Plain spatial mode keeps moving features together. The dynamic
				// variant partitions their initial positions too; growBounds() keeps
				// those local batches sound when an instance later crosses a cell.
				(mode === 'spatial' && group.dynamicRoot !== null) ||
				(group.meshes.length < MIN_SPATIAL_GROUP && geographicallyLocal)
			) {
				groups.push(group);
				continue;
			}
			const cells = new Map<string, THREE.Mesh<THREE.BufferGeometry, ColorMaterial>[]>();
			for (const mesh of group.meshes) {
				const x = mesh.matrixWorld.elements[12] ?? 0;
				const y = mesh.matrixWorld.elements[13] ?? 0;
				const z = mesh.matrixWorld.elements[14] ?? 0;
				const cell = `${levelAt(y)}:${Math.floor(x / CELL_SIZE)}:${Math.floor(z / CELL_SIZE)}`;
				const meshes = cells.get(cell);
				if (meshes) meshes.push(mesh);
				else cells.set(cell, [mesh]);
			}
			for (const meshes of cells.values()) groups.push({ dynamicRoot: group.dynamicRoot, meshes });
		}

		for (const group of groups) {
			const { dynamicRoot, meshes } = group;
			if (meshes.length < 2) continue;
			const first = meshes[0];
			if (!first) continue;
			const geometries = new Map<string, THREE.BufferGeometry>();
			for (const mesh of meshes) geometries.set(mesh.geometry.uuid, mesh.geometry);

			let vertices = 0;
			let indices = 0;
			for (const geometry of geometries.values()) {
				vertices += geometry.getAttribute('position').count;
				indices += geometry.index?.count ?? 0;
			}

			const material = first.material.clone() as ColorMaterial;
			material.color?.copy(WHITE);
			material.opacity = 1;
			const batched = new THREE.BatchedMesh(meshes.length, vertices, indices, material);
			batched.name = `renderBatch_${this.batches.length}`;
			batched.castShadow = first.castShadow;
			batched.receiveShadow = first.receiveShadow;
			batched.renderOrder = first.renderOrder;
			// Whole-object culling is one sphere-vs-frustum test per batch; three
			// computes the union sphere lazily on first use, which is valid because
			// update() below primes every instance matrix first and the batch sits at
			// identity in the scene root. The trap: setMatrixAt never invalidates
			// that sphere, so a batch whose source mesh moves after priming would be
			// culled while visible. update() grows the sphere over the mover
			// (growBounds above) so the test stays sound for every batch.
			batched.frustumCulled = true;
			// The aggressive mode deliberately keeps per-instance culling and opaque
			// front-to-back sorting available for A/B measurement. Both walk every
			// instance and dirty the indirect texture on every render, so the default
			// spatial mode relies on cheap whole-batch culling. Transparent instances
			// still require back-to-front order in every mode.
			batched.perObjectFrustumCulled = mode === 'spatial-sort';
			batched.sortObjects = material.transparent || mode === 'spatial-sort';

			const geometryIds = new Map<string, number>();
			for (const geometry of geometries.values()) geometryIds.set(geometry.uuid, batched.addGeometry(geometry));

			const sources: SourceInstance[] = [];
			for (const mesh of meshes) {
				const geometryId = geometryIds.get(mesh.geometry.uuid);
				if (geometryId === undefined) continue;
				const instanceId = batched.addInstance(geometryId);
				batched.setColorAt(instanceId, instanceColor(mesh.material));
				batched.setMatrixAt(instanceId, mesh.matrixWorld);
				batched.setVisibleAt(instanceId, isVisible(mesh));
				// Layer zero is used by all game/shadow cameras. A zero mask avoids
				// drawing the source without destroying its visible state.
				mesh.layers.mask = 0;
				sources.push({
					mesh,
					instanceId,
					geometryId,
					matrix: new THREE.Matrix4(),
					color: new THREE.Vector4(),
					visible: isVisible(mesh),
					streak: 0,
				});
				const source = sources[sources.length - 1];
				if (source) {
					source.matrix.copy(mesh.matrixWorld);
					source.color.copy(instanceColor(mesh.material));
				}
			}

			sourceMeshes += sources.length;
			if (dynamicRoot) dynamicSources += sources.length;
			batched.computeBoundingSphere();
			const radius = batched.boundingSphere?.radius ?? 0;
			largestRadius = Math.max(largestRadius, radius);
			const ownerKey = dynamicRoot?.uuid ?? 'static';
			const owner = ownerStats.get(ownerKey) ?? {
				name: dynamicRoot?.name || (dynamicRoot ? '(unnamed dynamic root)' : '(static)'),
				dynamic: dynamicRoot !== null,
				sources: 0,
				batches: 0,
				triangles: 0,
				largestRadius: 0,
			};
			owner.sources += sources.length;
			owner.batches++;
			owner.triangles += meshes.reduce((sum, mesh) => sum + geometryTriangles(mesh.geometry), 0);
			owner.largestRadius = Math.max(owner.largestRadius, radius);
			ownerStats.set(ownerKey, owner);
			this.batches.push({ mesh: batched, sources, dynamicRoot });
			scene.add(batched);
		}

		this.stats = {
			mode,
			sourceMeshes,
			dynamicSources,
			batchedMeshes: this.batches.length,
			drawCalls: this.batches.length,
			largestRadius,
			owners: [...ownerStats.values()],
		};
	}

	/**
	 * Hand the live hierarchy's transform, tint and visibility to the batches.
	 *
	 * Writing all three unconditionally re-uploaded the matrix, colour and
	 * indirect textures of every batch on every frame — 217 texture uploads per
	 * frame for a mall whose walls never move. Each value is therefore compared
	 * against the one the batch was last given, and only differences are sent.
	 */
	update(): void {
		for (const root of this.dynamicRoots) root.updateWorldMatrix(true, true);
		this.shard = (this.shard + 1) % COLD_SHARDS;
		let index = 0;
		for (const batch of this.batches) {
			if (!batch.dynamicRoot) continue;
			for (const source of batch.sources) {
				index++;
				if (source.streak >= STATIC_STREAK && index % COLD_SHARDS !== this.shard) continue;
				const world = source.mesh.matrixWorld;
				let changed = false;
				if (!source.matrix.equals(world)) {
					changed = true;
					source.matrix.copy(world);
					batch.mesh.setMatrixAt(source.instanceId, world);
					// Colour and visibility writes below don't move geometry, and
					// hidden instances are already inside the sphere, so only this branch
					// has to keep the frustum sphere honest.
					growBounds(batch.mesh, source);
				}

				const color = instanceColor(source.mesh.material);
				if (!source.color.equals(color)) {
					changed = true;
					source.color.copy(color);
					batch.mesh.setColorAt(source.instanceId, color);
				}

				const visible = isVisible(source.mesh);
				if (source.visible !== visible) {
					changed = true;
					source.visible = visible;
					batch.mesh.setVisibleAt(source.instanceId, visible);
				}
				source.streak = changed ? 0 : source.streak + 1;
			}
		}
	}
}
