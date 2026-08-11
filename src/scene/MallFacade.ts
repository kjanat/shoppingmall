import * as THREE from 'three';
import { CARDINAL_OUTWARD } from '#/data/spatial';
import type { FacadeReliefKind, FacadeReliefPiece } from '#/data/world';
import { FACADE_SIGN_SPEC, MALL_FACADE_RELIEF, MALL_FACADE_SIGNS } from '#/data/world';
import { shellShadowOn } from '#/render/graphicsPrefs';
import { lit } from '#/render/material';
import { fitText, labelCanvas, labelTexture } from '#/util/label';
import { half, midpoint, span } from '#/util/math';

/**
 * Het buitenwerk van de mall: het reliëf op de vier gevels en de twee
 * daklijstborden.
 *
 * Van buiten waren de wanden vier ongetextureerde platen van tweeënzeventig bij
 * veertien meter. Wat hier bijkomt is een plint, twee gordingen, een kroonlijst en
 * een verticale naad om de vier meter, allemaal uit `MALL_FACADE_RELIEF` — dezelfde
 * lijst waar de wandvolumes en `controleGevelwerk` uit lezen.
 *
 * Pi-budget: één InstancedMesh over een gedeelde eenheidskubus voor alle honderd
 * stukken samen, kleur per instance, en twee belettering-vlakken. Geen enkele lamp:
 * de letters gloeien uit de emissive van hun eigen materiaal, dus ze staan ook aan
 * als het zaallicht uitgaat.
 */

/** Kleur per soort gevelstuk. De naden zijn donkerder, dat is wat er schaduw van maakt. */
const RELIEF_COLORS = {
	plinth: 0xdcd4c6,
	course: 0xf6f2ea,
	cornice: 0xf8f4ec,
	seam: 0xd4cec3,
	sign: 0x1b2330,
} as const satisfies Readonly<Record<FacadeReliefKind, number>>;

/** Hoe ver de belettering voor zijn bord hangt, zodat hij er niet mee vecht. */
const LETTER_LIFT = 0.02;
/** Belettering: doek in ontwerp-eenheden, en de gloed die hem 's avonds draagt. */
const LETTER_CANVAS = { width: 1024, height: 192 };
const LETTER_GLOW = 0.75;
const LETTER_RULE_INSET = 8;
const LETTER_RULE_WIDTH = 4;

export class MallFacade {
	readonly group = new THREE.Group();

	private readonly materials: THREE.Material[] = [];
	private readonly geometries: THREE.BufferGeometry[] = [];
	private readonly textures: THREE.Texture[] = [];
	private readonly instanced: THREE.InstancedMesh[] = [];

	/** Gedeelde eenheidskubus: elk stuk gevelwerk is deze doos, geschaald. */
	private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
	private readonly dummy = new THREE.Object3D();

	constructor() {
		this.group.name = 'mall_facade';
		this.geometries.push(this.unitBox);
		this.buildRelief();
		this.buildSigns();
	}

	dispose(): void {
		for (const mesh of this.instanced) mesh.dispose();
		for (const material of this.materials) material.dispose();
		for (const geometry of this.geometries) geometry.dispose();
		for (const texture of this.textures) texture.dispose();
		this.group.clear();
	}

	private track<T extends THREE.Material>(material: T): T {
		this.materials.push(material);
		return material;
	}

	/** Alle banden, naden en bordkasten als één InstancedMesh, kleur per soort. */
	private buildRelief(): void {
		const pieces: readonly FacadeReliefPiece[] = [...MALL_FACADE_RELIEF, ...MALL_FACADE_SIGNS];
		const stone = this.track(lit({ color: 0xffffff, roughness: 0.9, metalness: 0.02 }));
		const mesh = new THREE.InstancedMesh(this.unitBox, stone, pieces.length);
		mesh.name = 'facade_relief';
		mesh.castShadow = shellShadowOn();
		mesh.receiveShadow = true;
		const tint = new THREE.Color();
		pieces.forEach((piece, index) => {
			this.dummy.position.set(
				midpoint(piece.minX, piece.maxX),
				midpoint(piece.minY, piece.maxY),
				midpoint(piece.minZ, piece.maxZ),
			);
			this.dummy.scale.set(span(piece.minX, piece.maxX), span(piece.minY, piece.maxY), span(piece.minZ, piece.maxZ));
			this.dummy.updateMatrix();
			mesh.setMatrixAt(index, this.dummy.matrix);
			mesh.setColorAt(index, tint.setHex(RELIEF_COLORS[piece.kind]));
		});
		mesh.computeBoundingSphere();
		this.instanced.push(mesh);
		this.group.add(mesh);
	}

	/** MALL SIM op de kroonlijst van de west- en de zuidgevel. */
	private buildSigns(): void {
		const wordmark = this.letterTexture();
		const letters = this.track(
			lit({
				map: wordmark,
				emissive: 0xffffff,
				emissiveMap: wordmark,
				emissiveIntensity: LETTER_GLOW,
				transparent: true,
				roughness: 1,
			}),
		);
		for (const board of MALL_FACADE_SIGNS) {
			const outward = CARDINAL_OUTWARD[board.side];
			const width = outward.x === 0 ? span(board.minX, board.maxX) : span(board.minZ, board.maxZ);
			const geometry = new THREE.PlaneGeometry(
				width - FACADE_SIGN_SPEC.inset * 2,
				span(board.minY, board.maxY) - FACADE_SIGN_SPEC.inset * 2,
			);
			this.geometries.push(geometry);
			const plane = new THREE.Mesh(geometry, letters);
			plane.position.set(
				midpoint(board.minX, board.maxX) + outward.x * (half(span(board.minX, board.maxX)) + LETTER_LIFT),
				midpoint(board.minY, board.maxY),
				midpoint(board.minZ, board.maxZ) + outward.z * (half(span(board.minZ, board.maxZ)) + LETTER_LIFT),
			);
			plane.rotation.y = Math.atan2(outward.x, outward.z);
			this.group.add(plane);
		}
	}

	/**
	 * De wordmark op een doorzichtig doek, met een dunne lijst eromheen. Het bord
	 * eronder is de donkere kast; wat hier gloeit zijn alleen de letters.
	 */
	private letterTexture(): THREE.CanvasTexture {
		const { canvas, ctx, w, h } = labelCanvas(LETTER_CANVAS.width, LETTER_CANVAS.height);
		const glow = ctx.createLinearGradient(0, 0, w, 0);
		glow.addColorStop(0, '#f7c873');
		glow.addColorStop(0.5, '#fffaf0');
		glow.addColorStop(1, '#f7c873');
		ctx.strokeStyle = glow;
		ctx.lineWidth = LETTER_RULE_WIDTH;
		ctx.strokeRect(LETTER_RULE_INSET, LETTER_RULE_INSET, w - LETTER_RULE_INSET * 2, h - LETTER_RULE_INSET * 2);
		ctx.fillStyle = glow;
		fitText(ctx, FACADE_SIGN_SPEC.text, { x: 0, y: 0, w, h }, { maxLines: 1, size: h, weight: '800' });
		const texture = labelTexture(canvas);
		this.textures.push(texture);
		return texture;
	}
}
