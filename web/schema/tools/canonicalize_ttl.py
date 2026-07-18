"""Canonicalize a Turtle file to byte-deterministic output.

Ported verbatim from sleep-scoring-web/packages/sleep-scoring-ontology/tools/
canonicalize_ttl.py (the sibling ontology's proven byte-repro tool) so the two
ecosystems share one canonicalization discipline. See that repo for history.

linkml's ``gen-shacl`` / ``gen-owl`` emit RDF that is not reproducible across
runs in two independent ways:

1. **Blank-node order** — ``sh:property`` / ``owl:Restriction`` blocks are
   serialized in an unstable order. ``rdflib.compare.to_canonical_graph``
   fixes this by relabelling blank nodes deterministically from graph
   structure.

2. **Unordered RDF lists** — ``sh:ignoredProperties`` is built from a Python
   set, so its RDF list (``rdf:first``/``rdf:rest`` chain) has random member
   order. An RDF list is order-significant, so two such runs are genuinely
   non-isomorphic graphs and canonicalization alone cannot reconcile them.
   The list is semantically a *set*, so its members are sorted here first.

Run as the final step of the OWL/SHACL Makefile recipes, this makes the
committed ``.ttl`` artifacts reproducible: ``make`` twice yields byte-identical
files.
"""

from __future__ import annotations

import sys
from pathlib import Path

from rdflib import Graph, Namespace
from rdflib.collection import Collection
from rdflib.compare import to_canonical_graph

SH = Namespace("http://www.w3.org/ns/shacl#")

# Objects of these predicates are RDF lists that represent unordered *sets* —
# their member order carries no meaning and is emitted non-deterministically.
_UNORDERED_LIST_PREDICATES = (SH.ignoredProperties,)


def _sort_unordered_lists(graph: Graph) -> None:
    """Sort the members of every order-insignificant RDF list in ``graph``."""
    for predicate in _UNORDERED_LIST_PREDICATES:
        for _subject, head in list(graph.subject_objects(predicate)):
            collection = Collection(graph, head)
            ordered = sorted(collection, key=str)
            for index, member in enumerate(ordered):
                collection[index] = member


def canonicalize(input_path: Path, output_path: Path) -> None:
    """Parse ``input_path`` as Turtle and write its canonical form to ``output_path``."""
    source = Graph()
    source.parse(input_path, format="turtle")
    _sort_unordered_lists(source)
    canonical = to_canonical_graph(source)
    # to_canonical_graph returns a read-only aggregate with no namespace
    # bindings. Copy its (canonically-labelled) triples into a fresh graph
    # carrying the source's prefixes; longturtle then serializes that fully
    # sorted, so the output keeps readable prefixes and is byte-stable.
    out = Graph()
    for prefix, namespace in source.namespaces():
        out.bind(prefix, namespace)
    for triple in canonical:
        out.add(triple)
    output_path.write_text(out.serialize(format="longturtle"))


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: canonicalize_ttl.py <input.ttl> <output.ttl>", file=sys.stderr)
        return 2
    canonicalize(Path(argv[1]), Path(argv[2]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
