function aStar(start, goal, neighbors, heuristic) {
  const open = new Map([[start, { node: start, g: 0, f: heuristic(start, goal) }]]);
  const cameFrom = new Map();
  const gScore = new Map([[start, 0]]);

  while (open.size) {
    let current = null;
    for (const entry of open.values()) {
      if (!current || entry.f < current.f) current = entry;
    }
    if (current.node === goal) {
      const path = [goal];
      let step = goal;
      while (cameFrom.has(step)) {
        step = cameFrom.get(step);
        path.unshift(step);
      }
      return path;
    }
    open.delete(current.node);
    for (const neighbor of neighbors(current.node)) {
      const tentative = gScore.get(current.node) + 1;
      if (tentative < (gScore.get(neighbor) ?? Infinity)) {
        cameFrom.set(neighbor, current.node);
        gScore.set(neighbor, tentative);
        open.set(neighbor, {
          node: neighbor,
          g: tentative,
          f: tentative + heuristic(neighbor, goal),
        });
      }
    }
  }
  return null;
}

module.exports = { aStar };
