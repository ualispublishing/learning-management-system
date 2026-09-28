import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeDepthLayersForCard, unlockNextLayer } from '../src/lib/depth/manager';
import { Card } from '../src/types';

const card = (): Card => ({
  id: 'card-depth', note_id: 'note-depth', deck_id: 'deck-depth', due: Date.now(), stability: 0, difficulty: 0,
  reps: 0, lapses: 0, state: 0, last_review: 0, learning_steps: 0, last_knob_value: 0,
  template_id: 'template-depth', position: 0, retrievability: 0, total_layers: 2, current_max_layer: 1, created_at: Date.now(),
});

test('depth-layer initialization uses collision-resistant ids', () => {
  const first = initializeDepthLayersForCard('card-depth', ['A', 'B']);
  const second = initializeDepthLayersForCard('card-depth', ['A', 'B']);
  assert.equal(new Set([...first, ...second].map(layer => layer.id)).size, 4);
});

test('unlocking a layer does not mutate repository-owned input objects', () => {
  const layers = initializeDepthLayersForCard('card-depth', ['A', 'B']);
  const original = layers.map(layer => ({ ...layer }));
  const result = unlockNextLayer(card(), layers);
  assert.deepEqual(layers, original);
  assert.equal(result.updatedCard.current_max_layer, 2);
  assert.equal(result.newlyUnlockedLayer?.is_unlocked, true);
  assert.ok(result.newlyUnlockedLayer?.unlocked_at);
});
