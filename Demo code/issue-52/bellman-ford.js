function bellmanFord(edges, vertices, source) {
  const distance = new Map();
  for (const v of vertices) distance.set(v, Infinity);
  distance.set(source, 0);

  for (let i = 0; i < vertices.length - 1; i += 1) {
    let updated = false;
    for (const { from, to, weight } of edges) {
      const distFrom = distance.get(from);
      if (distFrom + weight < distance.get(to)) {
        distance.set(to, distFrom + weight);
        updated = true;
      }
    }
    if (!updated) break;
  }

  for (const { from, to, weight } of edges) {
    if (distance.get(from) + weight < distance.get(to)) {
      return { distance, hasNegativeCycle: true };
    }
  }

  return { distance, hasNegativeCycle: false };
}

module.exports = { bellmanFord };
