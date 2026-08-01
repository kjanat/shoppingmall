import { EDGES, type GraphNode, NODES, type NodeId } from '@/data/graph';

interface Link {
	to: string;
	cost: number;
}

export class Pathfinder {
	private nodes = new Map<string, GraphNode>();
	private adj = new Map<string, Link[]>();

	constructor() {
		for (const n of NODES) this.nodes.set(n.id, n);

		const add = (from: string, to: string, cost: number) => {
			const links = this.adj.get(from) ?? [];
			links.push({ to, cost });
			this.adj.set(from, links);
		};

		for (const e of EDGES) {
			const a = this.nodes.get(e.from);
			const b = this.nodes.get(e.to);
			if (!a || !b) continue;
			const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * (e.cost ?? 1);
			add(e.from, e.to, dist);
			add(e.to, e.from, dist);
		}
	}

	getNode(id: NodeId): GraphNode | undefined {
		return this.nodes.get(id);
	}

	findPath(startId: NodeId, goalId: NodeId): GraphNode[] {
		if (startId === goalId) {
			const n = this.nodes.get(startId);
			return n ? [n] : [];
		}

		const open = new Set<string>([startId]);
		const came = new Map<string, string>();
		const g = new Map<string, number>([[startId, 0]]);
		const f = new Map<string, number>([[startId, this.h(startId, goalId)]]);

		while (open.size > 0) {
			let current = '';
			let best = Infinity;
			for (const id of open) {
				const score = f.get(id) ?? Infinity;
				if (score < best) {
					best = score;
					current = id;
				}
			}

			if (current === goalId) return this.reconstruct(came, current);

			open.delete(current);
			for (const link of this.adj.get(current) ?? []) {
				const tent = (g.get(current) ?? Infinity) + link.cost;
				if (tent < (g.get(link.to) ?? Infinity)) {
					came.set(link.to, current);
					g.set(link.to, tent);
					f.set(link.to, tent + this.h(link.to, goalId));
					open.add(link.to);
				}
			}
		}

		return [];
	}

	pathLength(path: GraphNode[]): number {
		let d = 0;
		for (let i = 1; i < path.length; i++) {
			const a = path[i - 1];
			const b = path[i];
			if (!a || !b) continue;
			d += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
		}
		return d;
	}

	private h(a: string, b: string): number {
		const na = this.nodes.get(a);
		const nb = this.nodes.get(b);
		// Unknown id: unreachable, so A* never picks it as the next best node.
		if (!na || !nb) return Infinity;
		return Math.hypot(na.x - nb.x, na.y - nb.y, na.z - nb.z);
	}

	private reconstruct(came: Map<string, string>, current: string): GraphNode[] {
		const path: GraphNode[] = [];
		for (let id: string | undefined = current; id !== undefined; id = came.get(id)) {
			const node = this.nodes.get(id);
			if (node) path.unshift(node);
		}
		return path;
	}
}
