import * as THREE from 'three';

export interface Node {
    id: string;
    type: "Space" | "Opening" | "Element" | string;
    ifcId: number;
    name?: string;
    centroid: { x: number; y: number; z: number };
    geometry?: { a: {x:number, y:number, z:number}, b: {x:number, y:number, z:number}, c: {x:number, y:number, z:number} }[];
    bbox?: THREE.Box3;
    subType?: "Door" | "Window" | string;
    storeyName?: string;
    spaceIfcId?: number;
    spaceName?: string;
    elementCategory?: "furniture" | "equipment" | "structure" | "other";
    isContainedInSpace?: boolean;
}

export interface Edge {
    id: string;
    from: string;
    to: string;
}

export class IndoorNetworkService {
    nodes: Node[] = [];
    edges: Edge[] = [];

    constructor(nodes: Node[], edges: Edge[]) {
        this.nodes = nodes;
        this.edges = edges;
    }

    // ... Any manipulation or post processing
}

