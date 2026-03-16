class TrieNode {
  constructor() {
    this.children = new Map();
    this.isWord = false;
  }
}

class Trie {
  constructor() {
    this.root = new TrieNode();
  }

  insert(word) {
    let node = this.root;
    for (const ch of word) {
      if (!node.children.has(ch)) node.children.set(ch, new TrieNode());
      node = node.children.get(ch);
    }
    node.isWord = true;
  }

  startsWith(prefix) {
    let node = this.root;
    for (const ch of prefix) {
      if (!node.children.has(ch)) return null;
      node = node.children.get(ch);
    }
    return node;
  }

  suggestions(prefix, limit = 10) {
    const node = this.startsWith(prefix);
    if (!node) return [];
    const results = [];
    const dfs = (current, path) => {
      if (results.length >= limit) return;
      if (current.isWord) results.push(path);
      for (const [ch, child] of current.children) {
        dfs(child, path + ch);
      }
    };
    dfs(node, prefix);
    return results;
  }
}

module.exports = { Trie, TrieNode };
