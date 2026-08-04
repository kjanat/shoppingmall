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

export function addPlaneMesh(
	parent: THREE.Object3D,
	material: THREE.Material,
	spec: MeshPlacement & Readonly<{ width: number; height: number }>,
): THREE.Mesh {
	return place(new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.height), material), parent, spec);
}
