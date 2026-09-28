/**
 * @fileoverview src/lib/depth/manager.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { Card, DepthLayer } from '../../types';
import { createEntityId } from '../id';

export function getVisibleLayers(card: Card, allLayers: DepthLayer[]): DepthLayer[] {
  // Sort layers by their layer number
  const sortedLayers = [...allLayers].sort((a, b) => a.layer_number - b.layer_number);
  
  // Return only the layers up to current_max_layer
  return sortedLayers.filter(layer => layer.layer_number <= card.current_max_layer);
}

export function unlockNextLayer(card: Card, allLayers: DepthLayer[]): { updatedCard: Card, newlyUnlockedLayer?: DepthLayer } {
  if (card.current_max_layer >= card.total_layers) {
    return { updatedCard: { ...card } }; // Already at max layer
  }
  
  const updatedCard = {
    ...card,
    current_max_layer: card.current_max_layer + 1,
  };
  
  const newlyUnlockedLayer = allLayers.find(l => l.layer_number === updatedCard.current_max_layer);
  const unlockedCopy = newlyUnlockedLayer ? {
    ...newlyUnlockedLayer,
    is_unlocked: true,
    unlocked_at: Date.now(),
  } : undefined;
  
  return { updatedCard, newlyUnlockedLayer: unlockedCopy };
}

export function initializeDepthLayersForCard(cardId: string, layerContents: string[]): DepthLayer[] {
  return layerContents.map((content, index) => ({
    id: createEntityId('layer'),
    card_id: cardId,
    layer_number: index + 1, // 1-indexed, layer 1 is first depth layer (back of card)
    content,
    source: 'manual',
    is_unlocked: index === 0, // First layer is unlocked by default
    unlocked_at: index === 0 ? Date.now() : undefined,
  }));
}
