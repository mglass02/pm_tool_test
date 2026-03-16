function dijkstra(graph, start) {
  const distances = new Map();
  const previous = new Map();
  const visited = new Set();
  const queue = [];

  for (const node of graph.keys()) {
    distances.set(node, node === start ? 0 : Infinity);
    queue.push(node);
  }

  while (queue.length) {
    queue.sort((a, b) => distances.get(a) - distances.get(b));
    const current = queue.shift();
    if (current === undefined) break;
    if (distances.get(current) === Infinity) break;

    visited.add(current);
    const neighbors = graph.get(current) || [];
    for (const { node, weight } of neighbors) {
      if (visited.has(node)) continue;
      const alt = distances.get(current) + weight;
      if (alt < distances.get(node)) {
        distances.set(node, alt);
        previous.set(node, current);
      }
    }
  }

  return { distances, previous };
}

function buildPath(previous, target) {
  const path = [];
  let current = target;
  while (current !== undefined) {
    path.unshift(current);
    current = previous.get(current);
  }
  return path;
}

module.exports = { dijkstra, buildPath };
