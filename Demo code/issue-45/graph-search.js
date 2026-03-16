function bfs(graph, start) {
  const visited = new Set([start]);
  const order = [];
  const queue = [start];
  while (queue.length) {
    const node = queue.shift();
    order.push(node);
    for (const neighbor of graph.get(node) || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return order;
}

function dfs(graph, start) {
  const visited = new Set();
  const order = [];
  const stack = [start];
  while (stack.length) {
    const node = stack.pop();
    if (visited.has(node)) continue;
    visited.add(node);
    order.push(node);
    const neighbors = graph.get(node) || [];
    for (let i = neighbors.length - 1; i >= 0; i -= 1) {
      if (!visited.has(neighbors[i])) stack.push(neighbors[i]);
    }
  }
  return order;
}

module.exports = { bfs, dfs };
