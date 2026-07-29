/**
 * Named shop owners — people with identity, not empty "VERKOPER" tags.
 * One Moroccan-Dutch owner (respectful, warm, bilingual vibe in speech only).
 */

export type ShopOwner = {
	storeId: string;
	name: string;
	title: string;
	/** short life meaning behind the counter */
	meaning: string;
	shirt: number;
	skin: number;
	hair: number;
	/** speech lines when a guest checks out */
	lines: string[];
	/** ElevenLabs voice id (character-correct) */
	voiceId?: string;
	/** BCP-47 hint for multilingual model */
	lang?: string;
};

export const SHOP_OWNERS: Record<string, ShopOwner> = {
	zara: {
		storeId: 'zara',
		name: 'Sofia',
		title: 'Manager',
		meaning: 'Helpt mensen zich zelfverzekerd voelen',
		shirt: 0x1a1a1a,
		skin: 0xe8b896,
		hair: 0x1a1a1a,
		lines: ['Looks great on you.', 'New drop — careful.'],
	},
	hm: {
		storeId: 'hm',
		name: 'Jess',
		title: 'Floor lead',
		meaning: 'Mode voor iedereen met een budget',
		shirt: 0xc41e3a,
		skin: 0xf5c9a8,
		hair: 0xc4a35a,
		lines: ['Two for one, babe.', 'Cart looking strong.'],
	},
	mediaworld: {
		storeId: 'mediaworld',
		name: 'Tom',
		title: 'Tech specialist',
		meaning: 'Tech die het leven makkelijker maakt',
		shirt: 0x0b3d91,
		skin: 0xd4a574,
		hair: 0x2c1810,
		lines: ['4K changes everything.', 'Extended warranty?'],
	},
	nike: {
		storeId: 'nike',
		name: 'Marcus',
		title: 'Athlete retail',
		meaning: 'Mensen in beweging krijgen',
		shirt: 0x111111,
		skin: 0x8d5524,
		hair: 0x1a1a1a,
		lines: ['Just do it.', 'Those go hard.'],
	},
	starbucks: {
		storeId: 'starbucks',
		name: 'Emily',
		title: 'Barista',
		meaning: 'Kleine warmte in een drukke dag',
		shirt: 0x00704a,
		skin: 0xf5c9a8,
		hair: 0x5c4033,
		lines: ['Name for the cup?', 'Extra shot — good call.'],
	},
	primark: {
		storeId: 'primark',
		name: 'Chloe',
		title: 'Cashier',
		meaning: 'Gezinnen laten meedoen zonder pijn',
		shirt: 0x005eb8,
		skin: 0xe8b896,
		hair: 0xd35400,
		lines: ['Basket full again!', 'Kids section is wild today.'],
	},
	apple: {
		storeId: 'apple',
		name: 'Alex',
		title: 'Specialist',
		meaning: 'Nieuwsgierigheid en creativiteit voeden',
		shirt: 0x1d1d1f,
		skin: 0xf5c9a8,
		hair: 0x2c1810,
		lines: ['Genius bar is free.', 'Setup takes two minutes.'],
	},
	ikea: {
		storeId: 'ikea',
		name: 'Lars',
		title: 'Home guide',
		meaning: 'Huizen tot thuis maken',
		shirt: 0x0051ba,
		skin: 0xe8b896,
		hair: 0xc4a35a,
		lines: ['You need the Allen key.', 'Meatballs after?'],
	},
	douglas: {
		storeId: 'douglas',
		name: 'Noor',
		title: 'Beauty advisor',
		meaning: 'Zelfzorg is geen luxe',
		shirt: 0x2d0a1a,
		skin: 0xd4a574,
		hair: 0x1a1a1a,
		lines: ['This scent is you.', 'Sample in the bag.'],
	},
	gamesman: {
		storeId: 'gamesman',
		name: 'Sam',
		title: 'Game master',
		meaning: 'Speelplezier serieus nemen',
		shirt: 0x9b5de5,
		skin: 0xf5c9a8,
		hair: 0x5c4033,
		lines: ['New DLC dropped.', 'Controller stock is spicy.'],
	},
	/** Moroccan-Dutch owner — warm, bilingual (NL + Darija-light), no caricature */
	kruidvat: {
		storeId: 'kruidvat',
		name: 'Youssef Benali',
		title: 'Filiaalmanager',
		meaning: 'Zorgen dat de buurt gezond & voordelig blijft',
		shirt: 0xe30613,
		skin: 0xc68642,
		hair: 0x1a1a1a,
		// Chris = warm conversational male; multilingual NL reads more natural than "Adam"
		voiceId: 'iP95p4xoKVk53GoZ742B',
		lang: 'nl',
		lines: [
			'Marhaba! Welkom bij Kruidvat, ik ben Youssef Benali.',
			'Vitamines? Goede keuze, wallah. Je moeder gaat blij zijn.',
			'Drie voor de prijs van twee — take it, yallah!',
			'Yallah, fijne dag nog! En let op de loopbanden hè.',
			'Ah, een klant! Kom dichterbij, de kassa is open.',
			'Shampoo, zonnebrand, paracetamol — alles hier, broeder.',
			'Brad? Die is er gisteren al geweest. Jij ook vitamines?',
			'Salam aleikum, volgende klant. Marhaba nogmaals!',
		],
	},
	sephora: {
		storeId: 'sephora',
		name: 'Maya',
		title: 'Artist',
		meaning: 'Expressie op ieders gezicht',
		shirt: 0x000000,
		skin: 0xd4a574,
		hair: 0x2c1810,
		lines: ['Let me match your undertone.', 'Glow looks expensive.'],
	},
	uniqlo: {
		storeId: 'uniqlo',
		name: 'Kenji',
		title: 'LifeWear guide',
		meaning: 'Eenvoud die blijft',
		shirt: 0xff0000,
		skin: 0xe8b896,
		hair: 0x1a1a1a,
		lines: ['Heattech saves winters.', 'AIRism is undefeated.'],
	},
	decathlon: {
		storeId: 'decathlon',
		name: 'Inès',
		title: 'Sport coach retail',
		meaning: 'Iedereen mag sporten, niet alleen pro’s',
		shirt: 0x0082c3,
		skin: 0xe8b896,
		hair: 0x3e2723,
		lines: ['Trail shoes on three.', 'Hydrate, champion.'],
	},
	rituals: {
		storeId: 'rituals',
		name: 'Lotte',
		title: 'Wellness host',
		meaning: 'Mensen even laten vertragen',
		shirt: 0x3d2914,
		skin: 0xf5c9a8,
		hair: 0xc4a35a,
		lines: ['Slow down… smell this.', 'Your mum will love the sakura.'],
	},
	coolblue: {
		storeId: 'coolblue',
		name: 'Pieter',
		title: 'Smile specialist',
		meaning: 'Tech met een glimlach leveren',
		shirt: 0x0090e3,
		skin: 0xe8b896,
		hair: 0x5c4033,
		lines: ['Bezorging morgen, beloofd.', 'Dat is een top deal.'],
	},
	action: {
		storeId: 'action',
		name: 'Fatima',
		title: 'Teamlead',
		meaning: 'Kleine luxe voor grote gezinnen',
		shirt: 0xe30613,
		skin: 0xc68642,
		hair: 0x1a1a1a,
		lines: ['Aanbieding bij de kassa!', 'Nog een doos? Yallah.'],
	},
	saucy: {
		storeId: 'saucy',
		name: 'Vesper',
		title: 'Night manager',
		meaning: 'Adult fun zonder oordeel — consent is hot',
		shirt: 0xff2d6a,
		skin: 0xe8b896,
		hair: 0x1a1a1a,
		voiceId: 'cgSgspJ2msm6clMCkdW9', // Jessica — playful
		lang: 'nl',
		lines: [
			'Welcome after dark… discreet bag included.',
			'Silk or velvet? Both if you behave.',
			'Date night upgrade? Excellent choice.',
			'No judgment — only good lighting.',
		],
	},
};

export function getOwner(storeId: string): ShopOwner | undefined {
	return SHOP_OWNERS[storeId];
}
