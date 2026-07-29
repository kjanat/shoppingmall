import {
	BloomEffect,
	EffectComposer,
	EffectPass,
	RenderPass,
	SMAAEffect,
	ToneMappingEffect,
	ToneMappingMode,
	VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';

export function createComposer(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
): EffectComposer {
	const composer = new EffectComposer(renderer, {
		frameBufferType: THREE.HalfFloatType,
	});

	composer.addPass(new RenderPass(scene, camera));

	const bloom = new BloomEffect({
		intensity: 0.85,
		luminanceThreshold: 0.35,
		luminanceSmoothing: 0.4,
		mipmapBlur: true,
		radius: 0.7,
	});

	const vignette = new VignetteEffect({
		darkness: 0.55,
		offset: 0.35,
	});

	const tone = new ToneMappingEffect({
		mode: ToneMappingMode.ACES_FILMIC,
	});

	const smaa = new SMAAEffect();

	composer.addPass(new EffectPass(camera, bloom, vignette, tone, smaa));

	return composer;
}
