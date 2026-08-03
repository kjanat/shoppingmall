import * as THREE from 'three';

type ColorMaterial = THREE.Material & { color?: THREE.Color };
type SourceInstance = {
	mesh: THREE.Mesh<THREE.BufferGeometry, ColorMaterial>;
	instanceId: number;
	/**
	 * The values this instance was last given. Every setter on a BatchedMesh marks
	 * one of its data textures dirty and a dirty texture is re-uploaded whole on
	 * the next render, so the batch is only told about a value that changed.
	 */
	matrix: THREE.Matrix4;
	color: THREE.Vector4;
	visible: boolean;
	primed: boolean;
};
type Batch = { mesh: THREE.BatchedMesh; sources: SourceInstance[] };

export type SceneBatchStats = { sourceMeshes: number; batchedMeshes: number; drawCalls: number };

const WHITE = new THREE.Color(0xffffff);
const INSTANCE_COLOR = new THREE.Vector4(1, 1, 1, 1);

function instanceColor(material: ColorMaterial): THREE.Vector4 {
	const color = material.color ?? WHITE;
	return INSTANCE_COLOR.set(color.r, color.g, color.b, material.opacity);
}

function materialKey(material: ColorMaterial): string {
	// Only include properties that alter the shader program or cannot be carried
	// per instance. Hundreds of scene materials differ only by UUID, base color
	// or tiny roughness choices; those differences should not create draw calls.
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
	const emissive = props['emissive'];

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
		roughness: quantize('roughness'),
		metalness: quantize('metalness'),
		emissive: emissive instanceof THREE.Color ? emissive.getHex() : 0,
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
	private readonly scene: THREE.Scene;

	constructor(scene: THREE.Scene) {
		this.scene = scene;
		const groups = new Map<string, THREE.Mesh<THREE.BufferGeometry, ColorMaterial>[]>();

		scene.traverse((object) => {
			if (!(object instanceof THREE.Mesh) || object instanceof THREE.BatchedMesh || object instanceof THREE.InstancedMesh) {
				return;
			}
			if (object instanceof THREE.SkinnedMesh || Array.isArray(object.material)) return;
			if (Object.keys(object.geometry.morphAttributes).length > 0) return;

			const material = object.material as ColorMaterial;
			const key = [
				materialKey(material),
				geometryLayoutKey(object.geometry),
				object.castShadow ? 'cast' : '',
				object.receiveShadow ? 'receive' : '',
				String(object.renderOrder),
			].join('::');
			const group = groups.get(key);
			if (group) group.push(object as THREE.Mesh<THREE.BufferGeometry, ColorMaterial>);
			else groups.set(key, [object as THREE.Mesh<THREE.BufferGeometry, ColorMaterial>]);
		});

		let sourceMeshes = 0;
		for (const meshes of groups.values()) {
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
			batched.frustumCulled = false;
			// Both of these make BatchedMesh walk every instance and rewrite its
			// indirect texture on every single render — its onBeforeRender only
			// skips that work when neither is set and no visibility changed. These
			// batches hold static mall geometry on a modest triangle budget, so
			// shading a few off-screen vertices is cheaper than a per-frame CPU pass
			// plus a texture upload per batch. Sorting stays where it actually earns
			// its keep: transparent materials, which need back-to-front order.
			batched.perObjectFrustumCulled = false;
			batched.sortObjects = material.transparent;

			const geometryIds = new Map<string, number>();
			for (const geometry of geometries.values()) geometryIds.set(geometry.uuid, batched.addGeometry(geometry));

			const sources: SourceInstance[] = [];
			for (const mesh of meshes) {
				const geometryId = geometryIds.get(mesh.geometry.uuid);
				if (geometryId === undefined) continue;
				const instanceId = batched.addInstance(geometryId);
				batched.setColorAt(instanceId, instanceColor(mesh.material));
				// Layer zero is used by all game/shadow cameras. A zero mask avoids
				// drawing the source without destroying its visible state.
				mesh.layers.mask = 0;
				sources.push({
					mesh,
					instanceId,
					matrix: new THREE.Matrix4(),
					color: new THREE.Vector4(),
					visible: true,
					primed: false,
				});
			}

			sourceMeshes += sources.length;
			this.batches.push({ mesh: batched, sources });
			scene.add(batched);
		}

		this.stats = { sourceMeshes, batchedMeshes: this.batches.length, drawCalls: this.batches.length };
		this.update();
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
		this.scene.updateMatrixWorld(true);
		for (const batch of this.batches) {
			for (const source of batch.sources) {
				const world = source.mesh.matrixWorld;
				if (!source.primed || !source.matrix.equals(world)) {
					source.matrix.copy(world);
					batch.mesh.setMatrixAt(source.instanceId, world);
				}

				const color = instanceColor(source.mesh.material);
				if (!source.primed || !source.color.equals(color)) {
					source.color.copy(color);
					batch.mesh.setColorAt(source.instanceId, color);
				}

				const visible = isVisible(source.mesh);
				if (!source.primed || source.visible !== visible) {
					source.visible = visible;
					batch.mesh.setVisibleAt(source.instanceId, visible);
				}

				source.primed = true;
			}
		}
	}
}
