import * as THREE from 'three';

export type Position3 = Readonly<{ x: number; y: number; z: number }>;
export type Rotation3 = Readonly<{ x: number; y: number; z: number }>;

export type MeshPlacement = Readonly<{
	position: Position3;
	rotation?: Rotation3;
	name?: string;
	castShadow?: boolean;
	receiveShadow?: boolean;
}>;

function place(mesh: THREE.Mesh, parent: THREE.Object3D, placement: MeshPlacement): THREE.Mesh {
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
	parent: THREE.Object3D,
	material: THREE.Material,
	spec: MeshPlacement & Readonly<{ width: number; height: number; depth: number }>,
): THREE.Mesh {
	return place(new THREE.Mesh(new THREE.BoxGeometry(spec.width, spec.height, spec.depth), material), parent, spec);
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
export function addSignBack(parent: THREE.Object3D, sign: THREE.Mesh, material: THREE.Material, gap: number): THREE.Mesh {
	const back = new THREE.Mesh(sign.geometry, material);
	back.position.copy(sign.position).addScaledVector(new THREE.Vector3(0, 0, 1).applyEuler(sign.rotation), -gap);
	back.rotation.set(sign.rotation.x, sign.rotation.y + Math.PI, sign.rotation.z);
	back.scale.copy(sign.scale);
	parent.add(back);
	return back;
}

export function addPlaneMesh(
	parent: THREE.Object3D,
	material: THREE.Material,
	spec: MeshPlacement & Readonly<{ width: number; height: number }>,
): THREE.Mesh {
	return place(new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.height), material), parent, spec);
}
