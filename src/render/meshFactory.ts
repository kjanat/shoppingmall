import type { Material, Object3D } from 'three';
import { BoxGeometry, Mesh, PlaneGeometry, Vector3 } from 'three';

export type Position3 = Readonly<{ x: number; y: number; z: number }>;
export type Rotation3 = Readonly<{ x: number; y: number; z: number }>;

export type MeshPlacement = Readonly<{
	position: Position3;
	rotation?: Rotation3;
	name?: string;
	castShadow?: boolean;
	receiveShadow?: boolean;
}>;

function place(mesh: Mesh, parent: Object3D, placement: MeshPlacement): Mesh {
	const { position, rotation, name, castShadow = false, receiveShadow = false } = placement;
	mesh.position.set(position.x, position.y, position.z);
	if (rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z);
	if (name) mesh.name = name;
	mesh.castShadow = castShadow;
	mesh.receiveShadow = receiveShadow;
	parent.add(mesh);
	return mesh;
}

export function addBoxMesh(
	parent: Object3D,
	material: Material,
	spec: MeshPlacement & Readonly<{ width: number; height: number; depth: number }>,
): Mesh {
	return place(new Mesh(new BoxGeometry(spec.width, spec.height, spec.depth), material), parent, spec);
}

/**
 * Een neutraal achtervlak achter een bord dat je van twee kanten kunt naderen.
 *
 * Een enkelzijdig vlak is van achteren niet te zien en een dubbelzijdig vlak laat de
 * tekst er spiegelbeeldig doorheen lezen. Een tweede vlak dat de andere kant op kijkt
 * doet geen van beide, en dat is wat de achterkant van een verkeersbord ook is: een
 * plaat. Het staat `gap` achter het bord, gemeten langs de kant waar het bord naar
 * kijkt, en deelt zijn geometrie en schaal.
 */
export function addSignBack(parent: Object3D, sign: Mesh, material: Material, gap: number): Mesh {
	const back = new Mesh(sign.geometry, material);
	back.position.copy(sign.position).addScaledVector(new Vector3(0, 0, 1).applyEuler(sign.rotation), -gap);
	back.rotation.set(sign.rotation.x, sign.rotation.y + Math.PI, sign.rotation.z);
	back.scale.copy(sign.scale);
	parent.add(back);
	return back;
}

export function addPlaneMesh(
	parent: Object3D,
	material: Material,
	spec: MeshPlacement & Readonly<{ width: number; height: number }>,
): Mesh {
	return place(new Mesh(new PlaneGeometry(spec.width, spec.height), material), parent, spec);
}
