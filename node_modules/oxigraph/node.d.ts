/* tslint:disable */
/* eslint-disable */

/**
 * RDF/JS DataFactory-compatible methods
 */
export function literal(value: string | undefined, languageOrDataType?: string | NamedNode | {language: string, direction?: "ltr" | "rtl"}): Literal;
export function quad(subject: Quad_Subject, predicate: Quad_Predicate, object: Quad_Object, graph?: Quad_Graph): Quad;

/**
 * RDF/JS-compatible BlankNode term
 */
export class BlankNode {
    readonly termType: "BlankNode";
    readonly value: string;

    equals(other: Term | null | undefined): boolean;
    toString(): string;
}

/**
 * RDF/JS-compatible DefaultGraph term
 */
export class DefaultGraph {
    readonly termType: "DefaultGraph";
    readonly value: "";

    equals(other: Term | null | undefined): boolean;
    toString(): string;
}

/**
 * RDF/JS-compatible Literal term
 */
export class Literal {
    readonly datatype: NamedNode;
    readonly language: string;
    readonly direction: "ltr" | "rtl" | "";
    readonly termType: "Literal";
    readonly value: string;

    equals(other: Term | null | undefined): boolean;
    toString(): string;
}

/**
 * RDF/JS-compatible BlankNode term
 */
export class NamedNode {
    readonly termType: "NamedNode";
    readonly value: string;

    equals(other: Term | null | undefined): boolean;
    toString(): string;
}

/**
 * BaseQuad is part of the RDF/JS spec and has no direct equivalent in Oxigraph.
 *
 * It's copied here from the RDF/JS reference types (https://github.com/rdfjs/types , MIT license) because:
 *  - RDF/JS DatasetCore's match method takes Term parameters.
 *  - RDF/JS's Term is defined in terms of BaseQuad and not Quad.
 */
export interface BaseQuad {
    readonly graph: Term;
    readonly object: Term;
    readonly predicate: Term;
    readonly subject: Term;
    readonly termType: "Quad";
    readonly value: "";

    equals(other: Term | null | undefined): boolean;
    toString(): string;
}

/**
 * RDF/JS-compatible Quad term
 */
export class Quad implements BaseQuad {
    readonly graph: Quad_Graph;
    readonly object: Quad_Object;
    readonly predicate: Quad_Predicate;
    readonly subject: Quad_Subject;
    readonly termType: "Quad";
    readonly value: "";

    equals(other: Term | null | undefined): boolean;
    toString(): string;
}

/**
 * Typedefs copied from the RDF/JS reference types (https://github.com/rdfjs/types)
 */
export type Quad_Graph = DefaultGraph | NamedNode | BlankNode | Variable;
export type Quad_Object = NamedNode | Literal | BlankNode | Quad | Variable;
export type Quad_Predicate = NamedNode | Variable;
export type Quad_Subject = NamedNode | BlankNode | Quad | Variable;

/**
 * RDF/JS-compatible Term typedef. See note above re: BaseQuad.
 */
export type Term = NamedNode | BlankNode | Literal | Variable | DefaultGraph | BaseQuad;

/**
 * RDF/JS-compatible Variable term
 */
export class Variable {
    readonly termType: "Variable";
    readonly value: string;

    equals(other: Term | null | undefined): boolean;
    toString(): string;
}



export class Store {
    readonly size: number;

    constructor(quads?: Iterable<Quad>);

    add(quad: Quad): void;

    delete(quad: Quad): void;

    dump(
    options: {
        format: string;
        from_graph_name?: BlankNode | DefaultGraph | NamedNode;
    }
    ): string;

    has(quad: Quad): boolean;

    load(
    input: string | UInt8Array | Iterable<string | UInt8Array>,
    options: {
        base_iri?: NamedNode | string;
        format: string;
        no_transaction?: boolean;
        to_graph_name?: BlankNode | DefaultGraph | NamedNode;
        unchecked?: boolean;
        lenient?: boolean;
    }
    ): void;

    match(subject?: Term | null, predicate?: Term | null, object?: Term | null, graph?: Term | null): Quad[];

    query(
    query: string,
    options?: {
        base_iri?: NamedNode | string;
        results_format?: string;
        default_graph?: BlankNode | DefaultGraph | NamedNode | Iterable<BlankNode | DefaultGraph | NamedNode>;
        named_graphs?: Iterable<BlankNode | NamedNode>;
        use_default_graph_as_union?: boolean;
    }
    ): boolean | Map<string, Term>[] | Quad[] | string;

    update(
    update: string,
    options?: {
        base_iri?: NamedNode | string;
    }
    ): void;
}



function parse(
input: string | UInt8Array,
options: {
    base_iri?: NamedNode | string;
    format: string;
    to_graph_name?: BlankNode | DefaultGraph | NamedNode;
    lenient?: boolean;
}
): Quad[];
function parse(
input: Iterable<string | UInt8Array>,
options: {
    base_iri?: NamedNode | string;
    format: string;
    to_graph_name?: BlankNode | DefaultGraph | NamedNode;
    lenient?: boolean;
}
): IterableIterator<Quad>;
function parse(
input: AsyncIterable<string | UInt8Array>,
options: {
    base_iri?: NamedNode | string;
    format: string;
    to_graph_name?: BlankNode | DefaultGraph | NamedNode;
    lenient?: boolean;
}
): AsyncIterableIterator<Quad>;



export function blankNode(value?: string | null): BlankNode;

export function defaultGraph(): DefaultGraph;

export function fromQuad(original: any): any;

export function fromTerm(original: any): any;

export function main(): void;

export function namedNode(value: string): NamedNode;

export function triple(subject: any, predicate: any, object: any): Quad;

export function variable(value: string): Variable;
