const clone = value => JSON.parse(JSON.stringify(value));
// Moving between scene tabs changes the view, not the project's editing history.
const signature = ({ sceneId, ...document }) => JSON.stringify(document);
export class EditHistory {
  constructor(limit = 100) { this.limit = limit; this.undo = []; this.redo = []; this.cur = null; this.curStr = ''; this.busy = false; this.group = null; this.last = 0; }
  reset(document) { this.undo = []; this.redo = []; this.setCurrent(document); }
  setCurrent(document) { this.cur = clone(document); this.curStr = signature(document); this.group = null; this.last = 0; }
  record(document, group = null, now = Date.now()) {
    const next = signature(document);
    if (!this.cur) { this.setCurrent(document); return false; }
    if (next === this.curStr) { this.cur = clone(document); return false; }
    if (!group || group !== this.group || now - this.last > 800) {
      this.undo.push(this.cur);
      if (this.undo.length > this.limit) this.undo.shift();
    }
    this.redo = []; this.cur = clone(document); this.curStr = next; this.group = group; this.last = now;
    return true;
  }
  destination(direction) { return clone((direction < 0 ? this.undo : this.redo).at(-1) || null); }
  // Call only after the destination has successfully loaded.
  accept(direction, actual) {
    const from = direction < 0 ? this.undo : this.redo, to = direction < 0 ? this.redo : this.undo;
    if (!from.length) return;
    to.push(this.cur); from.pop(); this.setCurrent(actual);
  }
}
