'use strict';

const { EventEmitter } = require('events');

// A tiny pub/sub used to push live updates to connected dashboards over SSE.
const bus = new EventEmitter();
bus.setMaxListeners(0);

/** Broadcast an event to all SSE subscribers. */
function emit(type, data) {
  bus.emit('sse', { type, data, at: Date.now() });
}

module.exports = { bus, emit };
