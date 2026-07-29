/**
 * Customized inventory per store — real product lists, prices, shelf roles.
 * Empty shops are dead shops.
 */

export type StockKind =
	| 'box'
	| 'bottle'
	| 'can'
	| 'bag'
	| 'device'
	| 'shoe'
	| 'garment'
	| 'sphere'
	| 'book';

export type StockItem = {
	name: string;
	price: number;
	kind: StockKind;
	color: number;
	/** relative size 0.5–1.5 */
	size?: number;
};

export type StoreInventory = {
	storeId: string;
	slogan: string;
	/** items stocked on shelves */
	items: StockItem[];
	/** what the cashier usually sells */
	bestsellers: string[];
};

export const INVENTORIES: Record<string, StoreInventory> = {
	zara: {
		storeId: 'zara',
		slogan: 'New in this week',
		bestsellers: ['Linen blazer', 'Wide jeans'],
		items: [
			{ name: 'Linen blazer', price: 89, kind: 'garment', color: 0x2c2c2c },
			{ name: 'Wide jeans', price: 49, kind: 'garment', color: 0x1e3a5f },
			{ name: 'White tee', price: 19, kind: 'garment', color: 0xf5f5f5 },
			{ name: 'Trench coat', price: 129, kind: 'garment', color: 0xc4a574 },
			{ name: 'Knit sweater', price: 39, kind: 'garment', color: 0x8b4513 },
			{ name: 'Mini bag', price: 29, kind: 'bag', color: 0x111111 },
			{ name: 'Loafers', price: 59, kind: 'shoe', color: 0x3e2723 },
			{ name: 'Silk scarf', price: 25, kind: 'garment', color: 0xe91e63 },
		],
	},
	hm: {
		storeId: 'hm',
		slogan: 'Fashion & quality at the best price',
		bestsellers: ['Basic hoodie', 'Mom jeans'],
		items: [
			{ name: 'Basic hoodie', price: 24, kind: 'garment', color: 0xc41e3a },
			{ name: 'Mom jeans', price: 29, kind: 'garment', color: 0x4169e1 },
			{ name: 'Rib tank', price: 9, kind: 'garment', color: 0xffc0cb },
			{ name: 'Cargo pants', price: 34, kind: 'garment', color: 0x556b2f },
			{ name: 'Denim jacket', price: 39, kind: 'garment', color: 0x4682b4 },
			{ name: 'Bucket hat', price: 12, kind: 'sphere', color: 0xf5deb3 },
			{ name: 'Canvas tote', price: 8, kind: 'bag', color: 0xffffff },
			{ name: 'Platforms', price: 34, kind: 'shoe', color: 0x1a1a1a },
		],
	},
	mediaworld: {
		storeId: 'mediaworld',
		slogan: 'Tech for every life',
		bestsellers: ['4K TV', 'Noise-cancelling headphones'],
		items: [
			{ name: '4K TV 55"', price: 599, kind: 'device', color: 0x111111 },
			{ name: 'Soundbar', price: 199, kind: 'box', color: 0x222222 },
			{ name: 'Laptop 15"', price: 899, kind: 'device', color: 0xc0c0c0 },
			{ name: 'NC headphones', price: 149, kind: 'sphere', color: 0x1a1a1a },
			{ name: 'Smartwatch', price: 249, kind: 'device', color: 0x333333 },
			{ name: 'Bluetooth speaker', price: 79, kind: 'can', color: 0x0b3d91 },
			{ name: 'USB-C hub', price: 39, kind: 'box', color: 0x444444 },
			{ name: 'Gaming mouse', price: 59, kind: 'device', color: 0xff0000 },
			{ name: 'SSD 1TB', price: 89, kind: 'box', color: 0x00a8ff },
		],
	},
	nike: {
		storeId: 'nike',
		slogan: 'Just do it',
		bestsellers: ['Air Max', 'Dri-FIT tee'],
		items: [
			{ name: 'Air Max', price: 140, kind: 'shoe', color: 0xffffff },
			{ name: 'Dunk Low', price: 120, kind: 'shoe', color: 0x111111 },
			{ name: 'Dri-FIT tee', price: 35, kind: 'garment', color: 0xff6600 },
			{ name: 'Track pants', price: 55, kind: 'garment', color: 0x1a1a1a },
			{ name: 'Running shorts', price: 30, kind: 'garment', color: 0x00a651 },
			{ name: 'Gym bag', price: 45, kind: 'bag', color: 0x222222 },
			{ name: 'Cap', price: 28, kind: 'sphere', color: 0xff0000 },
			{ name: 'Socks 3-pack', price: 16, kind: 'box', color: 0xeeeeee },
		],
	},
	starbucks: {
		storeId: 'starbucks',
		slogan: 'Coffee & community',
		bestsellers: ['Caramel Macchiato', 'Butter croissant'],
		items: [
			{ name: 'Caramel Macchiato', price: 4.95, kind: 'can', color: 0xc4a574 },
			{ name: 'Flat White', price: 3.95, kind: 'can', color: 0xf5e6d3 },
			{ name: 'Iced Latte', price: 4.5, kind: 'bottle', color: 0xd2b48c },
			{ name: 'Butter croissant', price: 2.8, kind: 'bag', color: 0xdaa520 },
			{ name: 'Blueberry muffin', price: 3.2, kind: 'sphere', color: 0x4b0082 },
			{ name: 'Cold brew bottle', price: 3.5, kind: 'bottle', color: 0x3e2723 },
			{ name: 'Mug classic', price: 14, kind: 'can', color: 0x00704a },
			{ name: 'Beans bag 250g', price: 9, kind: 'bag', color: 0x5d4037 },
		],
	},
	primark: {
		storeId: 'primark',
		slogan: 'Amazing fashion, amazing prices',
		bestsellers: ['Pajama set', 'Beach towel'],
		items: [
			{ name: 'Pajama set', price: 12, kind: 'garment', color: 0xffb6c1 },
			{ name: 'Beach towel', price: 8, kind: 'garment', color: 0x00bfff },
			{ name: 'Flip-flops', price: 5, kind: 'shoe', color: 0xff69b4 },
			{ name: 'Kids tee pack', price: 10, kind: 'box', color: 0xffd700 },
			{ name: 'Home candle', price: 4, kind: 'can', color: 0xf5deb3 },
			{ name: 'Sunglasses', price: 6, kind: 'device', color: 0x111111 },
			{ name: 'Backpack', price: 11, kind: 'bag', color: 0x005eb8 },
			{ name: 'Socks multipack', price: 3, kind: 'box', color: 0xffffff },
		],
	},
	apple: {
		storeId: 'apple',
		slogan: 'Think different',
		bestsellers: ['iPhone', 'AirPods'],
		items: [
			{ name: 'iPhone', price: 999, kind: 'device', color: 0x1d1d1f },
			{ name: 'AirPods Pro', price: 279, kind: 'box', color: 0xffffff },
			{ name: 'iPad', price: 579, kind: 'device', color: 0xc0c0c0 },
			{ name: 'MacBook Air', price: 1299, kind: 'device', color: 0xa8a8a8 },
			{ name: 'Apple Watch', price: 429, kind: 'device', color: 0x333333 },
			{ name: 'MagSafe charger', price: 45, kind: 'sphere', color: 0xffffff },
			{ name: 'USB-C cable', price: 19, kind: 'box', color: 0xeeeeee },
			{ name: 'Case clear', price: 49, kind: 'box', color: 0xaaddff },
		],
	},
	ikea: {
		storeId: 'ikea',
		slogan: 'The wonderful everyday',
		bestsellers: ['BILLY bookcase', 'KÖTTBULLAR'],
		items: [
			{ name: 'BILLY bookcase', price: 59, kind: 'box', color: 0xf5f5dc },
			{ name: 'POÄNG chair', price: 89, kind: 'box', color: 0x8b4513 },
			{ name: 'LACK table', price: 15, kind: 'box', color: 0xffffff },
			{ name: 'KALLAX shelf', price: 49, kind: 'box', color: 0xf0e68c },
			{ name: 'KÖTTBULLAR', price: 4, kind: 'bag', color: 0x8b0000 },
			{ name: 'Plant pot', price: 6, kind: 'can', color: 0xd2691e },
			{ name: 'LED lamp', price: 12, kind: 'device', color: 0xfffacd },
			{ name: 'Duvet cover', price: 19, kind: 'garment', color: 0x87ceeb },
		],
	},
	douglas: {
		storeId: 'douglas',
		slogan: 'Beauty made personal',
		bestsellers: ['Perfume set', 'Lip kit'],
		items: [
			{ name: 'Eau de parfum', price: 79, kind: 'bottle', color: 0xffd700 },
			{ name: 'Lip kit', price: 24, kind: 'box', color: 0xdc143c },
			{ name: 'Foundation', price: 34, kind: 'bottle', color: 0xf5c9a8 },
			{ name: 'Mascara', price: 18, kind: 'bottle', color: 0x1a1a1a },
			{ name: 'Face cream', price: 42, kind: 'can', color: 0xfff0f5 },
			{ name: 'Nail polish', price: 12, kind: 'bottle', color: 0xff1493 },
			{ name: 'Gift set', price: 55, kind: 'box', color: 0x2d0a1a },
			{ name: 'Makeup sponge', price: 8, kind: 'sphere', color: 0xffb6c1 },
		],
	},
	gamesman: {
		storeId: 'gamesman',
		slogan: 'Level up your free time',
		bestsellers: ['Controller', 'Indie hits pack'],
		items: [
			{ name: 'Pro controller', price: 69, kind: 'device', color: 0x1a1a1a },
			{ name: 'AAA title', price: 59, kind: 'box', color: 0x9b5de5 },
			{ name: 'Indie pack', price: 29, kind: 'box', color: 0x00ffc8 },
			{ name: 'Headset RGB', price: 89, kind: 'device', color: 0xff00aa },
			{ name: 'Keyboard mech', price: 119, kind: 'device', color: 0x222233 },
			{ name: 'Mousepad XL', price: 25, kind: 'garment', color: 0x111122 },
			{ name: 'Figure limited', price: 45, kind: 'sphere', color: 0xffaa00 },
			{ name: 'Gift card €50', price: 50, kind: 'box', color: 0x9b5de5 },
		],
	},
	kruidvat: {
		storeId: 'kruidvat',
		slogan: 'Altijd verrassend, altijd voordelig',
		bestsellers: ['Vitamine D', 'Shampoo 3-voor'],
		items: [
			{ name: 'Vitamine D', price: 4.99, kind: 'bottle', color: 0xffee88 },
			{ name: 'Shampoo large', price: 2.49, kind: 'bottle', color: 0x00a651 },
			{ name: 'Tissues 12-pack', price: 3.99, kind: 'box', color: 0xeeeeee },
			{ name: 'Pain relief', price: 5.49, kind: 'box', color: 0xe30613 },
			{ name: 'Body lotion', price: 3.29, kind: 'bottle', color: 0xffc0cb },
			{ name: 'Toothpaste 2-pack', price: 2.99, kind: 'box', color: 0x00bfff },
			{ name: 'Sunscreen SPF50', price: 6.99, kind: 'bottle', color: 0xfffacd },
			{ name: 'Makeup remover', price: 3.49, kind: 'bottle', color: 0x87ceeb },
			{ name: 'Allergy tabs', price: 7.99, kind: 'box', color: 0x90ee90 },
			{ name: 'Cotton pads', price: 1.49, kind: 'bag', color: 0xffffff },
		],
	},
	sephora: {
		storeId: 'sephora',
		slogan: 'Beauty together',
		bestsellers: ['Lip stain', 'Serum'],
		items: [
			{ name: 'Lip stain', price: 28, kind: 'bottle', color: 0xb00020 },
			{ name: 'Vitamin serum', price: 48, kind: 'bottle', color: 0xffe4b5 },
			{ name: 'Palette eyes', price: 52, kind: 'box', color: 0x1a1a1a },
			{ name: 'Setting spray', price: 32, kind: 'bottle', color: 0xc0c0c0 },
			{ name: 'Brush set', price: 39, kind: 'box', color: 0xdaa520 },
			{ name: 'Highlighter', price: 26, kind: 'can', color: 0xffd700 },
			{ name: 'Perfume travel', price: 35, kind: 'bottle', color: 0x000000 },
			{ name: 'Skincare kit', price: 64, kind: 'box', color: 0xf5f5f5 },
		],
	},
	uniqlo: {
		storeId: 'uniqlo',
		slogan: 'LifeWear',
		bestsellers: ['Heattech', 'AIRism tee'],
		items: [
			{ name: 'AIRism tee', price: 19, kind: 'garment', color: 0xffffff },
			{ name: 'Heattech crew', price: 24, kind: 'garment', color: 0x808080 },
			{ name: 'Ultra light down', price: 69, kind: 'garment', color: 0x000080 },
			{ name: 'Chino pants', price: 39, kind: 'garment', color: 0xd2b48c },
			{ name: 'Socks pack', price: 9, kind: 'box', color: 0x333333 },
			{ name: 'Linen shirt', price: 34, kind: 'garment', color: 0xfaf0e6 },
			{ name: 'Tote bag', price: 12, kind: 'bag', color: 0xff0000 },
			{ name: 'Sneakers', price: 49, kind: 'shoe', color: 0xf5f5f5 },
		],
	},
	decathlon: {
		storeId: 'decathlon',
		slogan: 'Sport for all',
		bestsellers: ['Football', 'Hiking flask'],
		items: [
			{ name: 'Football size 5', price: 15, kind: 'sphere', color: 0xffffff },
			{ name: 'Hiking flask', price: 12, kind: 'bottle', color: 0x0082c3 },
			{ name: 'Yoga mat', price: 18, kind: 'garment', color: 0x9acd32 },
			{ name: 'Dumbbell 5kg', price: 22, kind: 'can', color: 0x2f4f4f },
			{ name: 'Bike helmet', price: 29, kind: 'sphere', color: 0xffed00 },
			{ name: 'Swim goggles', price: 9, kind: 'device', color: 0x00ced1 },
			{ name: 'Sports bag', price: 19, kind: 'bag', color: 0x0082c3 },
			{ name: 'Trail shoes', price: 59, kind: 'shoe', color: 0xff4500 },
		],
	},
	rituals: {
		storeId: 'rituals',
		slogan: 'Slow down',
		bestsellers: ['Sakura body set', 'Scented candle'],
		items: [
			{ name: 'Sakura shower', price: 12.5, kind: 'bottle', color: 0xffb7c5 },
			{ name: 'Body cream', price: 18.9, kind: 'can', color: 0xf5e6d3 },
			{ name: 'Scented candle', price: 22, kind: 'can', color: 0x3d2914 },
			{ name: 'Hand wash', price: 9.5, kind: 'bottle', color: 0xc4a574 },
			{ name: 'Home perfume', price: 29, kind: 'bottle', color: 0x8b7355 },
			{ name: 'Gift box', price: 39, kind: 'box', color: 0x2c1810 },
			{ name: 'Lip balm', price: 7, kind: 'bottle', color: 0xe8b4b8 },
			{ name: 'Expand shampoo', price: 14.9, kind: 'bottle', color: 0xd4a574 },
		],
	},
	coolblue: {
		storeId: 'coolblue',
		slogan: 'Alles voor een glimlach',
		bestsellers: ['Wasdroger', 'OLED TV'],
		items: [
			{ name: 'OLED TV 65"', price: 1499, kind: 'device', color: 0x0a0a0a },
			{ name: 'Wasdroger', price: 599, kind: 'box', color: 0xffffff },
			{ name: 'Robot vacuum', price: 349, kind: 'sphere', color: 0x0090e3 },
			{ name: 'Espresso machine', price: 429, kind: 'device', color: 0xc0c0c0 },
			{ name: 'Phone case', price: 24, kind: 'box', color: 0xff9c00 },
			{ name: 'Powerbank', price: 39, kind: 'box', color: 0x333333 },
			{ name: 'E-reader', price: 139, kind: 'device', color: 0xf5f5f5 },
			{ name: 'Webcam 4K', price: 99, kind: 'device', color: 0x1a1a1a },
		],
	},
	action: {
		storeId: 'action',
		slogan: 'Meer dan je verwacht',
		bestsellers: ['LED string', 'Snacks tray'],
		items: [
			{ name: 'LED string lights', price: 3.99, kind: 'box', color: 0xffff99 },
			{ name: 'Snacks tray', price: 1.99, kind: 'box', color: 0xff6347 },
			{ name: 'Cleaning spray', price: 1.49, kind: 'bottle', color: 0x00bfff },
			{ name: 'Notebook A5', price: 0.99, kind: 'book', color: 0xffd700 },
			{ name: 'Plant seeds', price: 1.29, kind: 'bag', color: 0x228b22 },
			{ name: 'Mug funny', price: 1.79, kind: 'can', color: 0xe30613 },
			{ name: 'Phone cable', price: 2.49, kind: 'box', color: 0x111111 },
			{ name: 'Party plates', price: 1.19, kind: 'box', color: 0xff69b4 },
		],
	},
};

export function getInventory(storeId: string): StoreInventory | undefined {
	return INVENTORIES[storeId];
}
