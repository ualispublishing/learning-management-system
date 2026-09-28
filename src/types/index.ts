/**
 * @fileoverview src/types/index.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export enum CardState {
  New = 0,
  Learning = 1,
  Review = 2,
  Relearning = 3,
}

export enum ReviewSource {
  Session = 'session',
  Notification = 'notification',
  ReviewSection = 'review_section',
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  settings: Record<string, unknown>;
  fsrs_parameters: number[];
  last_deck_id?: string;
  created_at: number;
  deleted_at?: number;
}

export interface DeckSettings {
  bannerType?: string;
  cardColor?: string;
  cardTextColor?: string;
  notifSchedule?: {
    active: boolean;
    frequency: number;
    startTime: string;
    endTime: string;
  };
  [key: string]: unknown;
}

export interface Deck {
  id: string;
  user_id: string;
  parent_id?: string;
  name: string;
  description: string;
  settings: DeckSettings;
  position: number;
  completed_once: boolean;
  first_completed_at?: number;
  created_at: number;
  deleted_at?: number;
  dueCount?: number;
  totalCount?: number;
  newCount?: number;
}

export interface NoteType {
  id: string;
  user_id: string;
  name: string;
  css: string;
  config: Record<string, unknown>;
  deleted_at?: number;
}

export interface Field {
  id: string;
  note_type_id: string;
  name: string;
  position: number;
  field_type: string;
  required: boolean;
  deleted_at?: number;
}

export interface DepthTemplate {
  id: string;
  note_type_id: string;
  layer_number: number;
  label: string;
  content_template: string;
  deleted_at?: number;
}

export interface Note {
  id: string;
  note_type_id: string;
  field_values: Record<string, string>;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}

export interface Card {
  id: string;
  note_id: string;
  deck_id: string;
  template_id: string;
  position?: number;
  difficulty: number;
  stability: number;
  retrievability: number;
  state: CardState;
  last_knob_value: number;
  current_max_layer: number;
  total_layers: number;
  due: number;
  reps: number;
  lapses: number;
  learning_steps: number;
  last_review: number;
  created_at: number;
  deleted_at?: number;
}

export interface DepthLayer {
  id: string;
  card_id: string;
  layer_number: number;
  content: string;
  source: string;
  is_unlocked: boolean;
  unlocked_at?: number;
  deleted_at?: number;
}

export interface CardNote {
  id: string;
  card_id: string;
  content: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}

export interface CardTemplate {
  id: string;
  note_type_id: string;
  name: string;
  front_template: string;
  back_template: string;
  position: number;
  deleted_at?: number;
}

export interface ReviewLog {
  id: string;
  card_id: string;
  knob_value: number;
  fsrs_rating: number;
  elapsed_days: number;
  scheduled_days: number;
  state_before: CardState;
  state_after: CardState;
  difficulty_before: number;
  stability_before: number;
  difficulty_after: number;
  stability_after: number;
  duration_ms: number;
  depth_layer_shown: number;
  review_source: ReviewSource;
  reviewed_at: number;
  deleted_at?: number;
}

export interface NotifSchedule {
  id: string;
  deck_id: string;
  frequency_minutes: number;
  start_time: string;
  end_time: string;
  active_days: string[];
  card_selection: string;
  is_active: boolean;
  deleted_at?: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  deleted_at?: number;
}

export interface CardTag {
  card_id: string;
  tag_id: string;
}
