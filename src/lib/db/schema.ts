/**
 * @fileoverview src/lib/db/schema.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import * as SQLite from 'expo-sqlite';

export async function initDB() {
  const db = await SQLite.openDatabaseAsync('flashcards.db');

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      display_name TEXT,
      settings TEXT,
      fsrs_parameters TEXT,
      last_deck_id TEXT,
      created_at INTEGER,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      parent_id TEXT,
      name TEXT,
      description TEXT,
      settings TEXT,
      position INTEGER,
      completed_once INTEGER DEFAULT 0,
      first_completed_at INTEGER,
      created_at INTEGER,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS note_types (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT,
      css TEXT,
      config TEXT,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS fields (
      id TEXT PRIMARY KEY,
      note_type_id TEXT,
      name TEXT,
      position INTEGER,
      field_type TEXT,
      required INTEGER DEFAULT 0,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS depth_templates (
      id TEXT PRIMARY KEY,
      note_type_id TEXT,
      layer_number INTEGER,
      label TEXT,
      content_template TEXT,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      note_type_id TEXT,
      field_values TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      note_id TEXT,
      deck_id TEXT,
      template_id TEXT,
      position INTEGER,
      difficulty REAL,
      stability REAL,
      retrievability REAL,
      state INTEGER,
      last_knob_value INTEGER,
      current_max_layer INTEGER,
      total_layers INTEGER,
      due INTEGER,
      reps INTEGER,
      lapses INTEGER,
      learning_steps INTEGER NOT NULL DEFAULT 0,
      last_review INTEGER,
      created_at INTEGER,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS depth_layers (
      id TEXT PRIMARY KEY,
      card_id TEXT,
      layer_number INTEGER,
      content TEXT,
      source TEXT,
      is_unlocked INTEGER DEFAULT 0,
      unlocked_at INTEGER,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS card_notes (
      id TEXT PRIMARY KEY,
      card_id TEXT,
      content TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS card_templates (
      id TEXT PRIMARY KEY,
      note_type_id TEXT,
      name TEXT,
      front_template TEXT,
      back_template TEXT,
      position INTEGER,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS review_logs (
      id TEXT PRIMARY KEY,
      card_id TEXT,
      knob_value INTEGER,
      fsrs_rating INTEGER,
      elapsed_days REAL,
      scheduled_days REAL,
      state_before INTEGER,
      state_after INTEGER,
      difficulty_before REAL,
      stability_before REAL,
      difficulty_after REAL,
      stability_after REAL,
      duration_ms INTEGER,
      depth_layer_shown INTEGER,
      review_source TEXT,
      reviewed_at INTEGER,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS notif_schedules (
      id TEXT PRIMARY KEY,
      deck_id TEXT,
      frequency_minutes INTEGER,
      start_time TEXT,
      end_time TEXT,
      active_days TEXT,
      card_selection TEXT,
      is_active INTEGER DEFAULT 1,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT,
      color TEXT,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS card_tags (
      card_id TEXT,
      tag_id TEXT,
      PRIMARY KEY (card_id, tag_id)
    );

    -- LMS SPECIFIC TABLES
    CREATE TABLE IF NOT EXISTS lms_courses (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      instructor_id TEXT,
      created_at INTEGER,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS lms_enrollments (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      course_id TEXT,
      role TEXT, -- 'student', 'ta', 'teacher'
      status TEXT,
      enrolled_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS lms_content_items (
      id TEXT PRIMARY KEY,
      course_id TEXT,
      category TEXT,
      title TEXT,
      description TEXT,
      content_url TEXT,
      display_date TEXT,
      available_date TEXT,
      is_graded INTEGER DEFAULT 1,
      is_pop_quiz INTEGER DEFAULT 0,
      group_icon TEXT,
      presentation_slot TEXT, -- 'past', 'current', 'future', 'scheduled'
      position INTEGER,
      created_at INTEGER,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS lms_assessments (
      id TEXT PRIMARY KEY,
      item_id TEXT,
      course_id TEXT,
      type TEXT,
      payload TEXT, -- JSON for the Qx: ==== parser output
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS lms_submissions (
      id TEXT PRIMARY KEY,
      item_id TEXT,
      user_id TEXT,
      answers TEXT, -- JSON
      grade TEXT,
      submitted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS lms_chat_threads (
      id TEXT PRIMARY KEY,
      course_id TEXT,
      title TEXT,
      is_announcement INTEGER DEFAULT 0,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS lms_chat_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT,
      user_id TEXT,
      content TEXT,
      created_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_cards_deck_due ON cards(deck_id, due) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_cards_note ON cards(note_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_review_logs_card_time ON review_logs(card_id, reviewed_at);
    CREATE INDEX IF NOT EXISTS idx_depth_layers_card_layer ON depth_layers(card_id, layer_number) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_decks_owner_parent_position ON decks(user_id, parent_id, position) WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_depth_layers_card_layer_unique ON depth_layers(card_id, layer_number) WHERE deleted_at IS NULL;

    CREATE TRIGGER IF NOT EXISTS validate_deck_owner_insert
    BEFORE INSERT ON decks
    WHEN NEW.user_id IS NULL OR trim(NEW.user_id) = ''
    BEGIN
      SELECT RAISE(ABORT, 'Deck owner is required');
    END;

    CREATE TRIGGER IF NOT EXISTS validate_deck_owner_update
    BEFORE UPDATE OF user_id ON decks
    WHEN NEW.user_id IS NULL OR trim(NEW.user_id) = ''
    BEGIN
      SELECT RAISE(ABORT, 'Deck owner is required');
    END;

    CREATE TRIGGER IF NOT EXISTS validate_deck_parent_insert
    BEFORE INSERT ON decks
    WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM decks parent
      WHERE parent.id = NEW.parent_id AND parent.user_id = NEW.user_id AND parent.deleted_at IS NULL
    )
    BEGIN
      SELECT RAISE(ABORT, 'Deck parent is missing or belongs to another account');
    END;

    CREATE TRIGGER IF NOT EXISTS validate_deck_parent_update_v2
    BEFORE UPDATE OF parent_id, user_id ON decks
    WHEN NEW.parent_id = NEW.id OR (
      NEW.parent_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM decks parent
        WHERE parent.id = NEW.parent_id AND parent.user_id = NEW.user_id AND parent.deleted_at IS NULL
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'Deck parent is missing or belongs to another account');
    END;

    CREATE TRIGGER IF NOT EXISTS validate_card_refs_insert
    BEFORE INSERT ON cards
    WHEN NOT EXISTS (SELECT 1 FROM decks WHERE id = NEW.deck_id AND deleted_at IS NULL)
      OR NOT EXISTS (SELECT 1 FROM notes WHERE id = NEW.note_id AND deleted_at IS NULL)
    BEGIN
      SELECT RAISE(ABORT, 'Card deck or note is missing');
    END;

    CREATE TRIGGER IF NOT EXISTS validate_card_refs_update
    BEFORE UPDATE OF deck_id, note_id ON cards
    WHEN NOT EXISTS (SELECT 1 FROM decks WHERE id = NEW.deck_id AND deleted_at IS NULL)
      OR NOT EXISTS (SELECT 1 FROM notes WHERE id = NEW.note_id AND deleted_at IS NULL)
    BEGIN
      SELECT RAISE(ABORT, 'Card deck or note is missing');
    END;

    CREATE TRIGGER IF NOT EXISTS validate_layer_card_insert
    BEFORE INSERT ON depth_layers
    WHEN NOT EXISTS (SELECT 1 FROM cards WHERE id = NEW.card_id AND deleted_at IS NULL)
    BEGIN
      SELECT RAISE(ABORT, 'Card page references a missing card');
    END;

    CREATE TRIGGER IF NOT EXISTS validate_layer_card_update
    BEFORE UPDATE OF card_id ON depth_layers
    WHEN NOT EXISTS (SELECT 1 FROM cards WHERE id = NEW.card_id AND deleted_at IS NULL)
    BEGIN
      SELECT RAISE(ABORT, 'Card page references a missing card');
    END;

    CREATE TRIGGER IF NOT EXISTS validate_review_card_insert
    BEFORE INSERT ON review_logs
    WHEN NOT EXISTS (SELECT 1 FROM cards WHERE id = NEW.card_id AND deleted_at IS NULL)
    BEGIN
      SELECT RAISE(ABORT, 'Review references a missing card');
    END;

    CREATE TRIGGER IF NOT EXISTS validate_review_card_update
    BEFORE UPDATE OF card_id ON review_logs
    WHEN NOT EXISTS (SELECT 1 FROM cards WHERE id = NEW.card_id AND deleted_at IS NULL)
    BEGIN
      SELECT RAISE(ABORT, 'Review references a missing card');
    END;

    CREATE TRIGGER IF NOT EXISTS validate_card_tag_insert
    BEFORE INSERT ON card_tags
    WHEN NOT EXISTS (SELECT 1 FROM cards WHERE id = NEW.card_id AND deleted_at IS NULL)
      OR NOT EXISTS (SELECT 1 FROM tags WHERE id = NEW.tag_id AND deleted_at IS NULL)
    BEGIN
      SELECT RAISE(ABORT, 'Card tag references a missing record');
    END;
  `);

  // CREATE TABLE IF NOT EXISTS does not add columns to an existing database.
  const cardColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(cards)');
  if (!cardColumns.some(column => column.name === 'learning_steps')) {
    await db.execAsync('ALTER TABLE cards ADD COLUMN learning_steps INTEGER NOT NULL DEFAULT 0');
  }

  const integrity = await db.getFirstAsync<{ quick_check: string }>('PRAGMA quick_check');
  if (integrity?.quick_check !== 'ok') {
    throw new Error(`The local flashcard database failed its integrity check: ${integrity?.quick_check ?? 'unknown error'}.`);
  }

  const activeDecks = await db.getAllAsync<{ id: string; user_id: string | null; parent_id: string | null }>(
    'SELECT id, user_id, parent_id FROM decks WHERE deleted_at IS NULL',
  );
  const deckById = new Map(activeDecks.map(deck => [deck.id, deck]));
  for (const deck of activeDecks) {
    if (typeof deck.id !== 'string' || !deck.id.trim() || typeof deck.user_id !== 'string' || !deck.user_id.trim()) {
      throw new Error('The local flashcard database contains a deck with an invalid identity or owner.');
    }
    if (!deck.parent_id) continue;
    const parent = deckById.get(deck.parent_id);
    if (!parent) throw new Error(`Local deck "${deck.id}" references a missing parent.`);
    if (parent.user_id !== deck.user_id) throw new Error(`Local deck "${deck.id}" has a parent owned by another flashcard account.`);
  }
  const visitState = new Map<string, 'visiting' | 'visited'>();
  const visitDeck = (deckId: string) => {
    const state = visitState.get(deckId);
    if (state === 'visiting') throw new Error('The local flashcard deck hierarchy contains a cycle.');
    if (state === 'visited') return;
    visitState.set(deckId, 'visiting');
    const parentId = deckById.get(deckId)?.parent_id;
    if (parentId) visitDeck(parentId);
    visitState.set(deckId, 'visited');
  };
  activeDecks.forEach(deck => visitDeck(deck.id));

  const crossOwnerNote = await db.getFirstAsync<{ id: string }>(
    `SELECT n.id
     FROM notes n
     JOIN cards c ON c.note_id = n.id AND c.deleted_at IS NULL
     JOIN decks d ON d.id = c.deck_id AND d.deleted_at IS NULL
     WHERE n.deleted_at IS NULL
     GROUP BY n.id
     HAVING COUNT(DISTINCT d.user_id) > 1
     LIMIT 1`,
  );
  if (crossOwnerNote) throw new Error(`Local note "${crossOwnerNote.id}" is linked to more than one flashcard account.`);

  const brokenReference = await db.getFirstAsync<{ id: string }>(
    `SELECT c.id
     FROM cards c
     LEFT JOIN decks d ON d.id = c.deck_id AND d.deleted_at IS NULL
     LEFT JOIN notes n ON n.id = c.note_id AND n.deleted_at IS NULL
     WHERE c.deleted_at IS NULL AND (d.id IS NULL OR n.id IS NULL)
     LIMIT 1`,
  );
  if (brokenReference) throw new Error(`Local card "${brokenReference.id}" references missing data.`);

  const brokenDependent = await db.getFirstAsync<{ id: string; kind: string }>(
    `SELECT id, kind FROM (
       SELECT l.id AS id, 'card page' AS kind
       FROM depth_layers l LEFT JOIN cards c ON c.id = l.card_id AND c.deleted_at IS NULL
       WHERE l.deleted_at IS NULL AND c.id IS NULL
       UNION ALL
       SELECT r.id AS id, 'review' AS kind
       FROM review_logs r LEFT JOIN cards c ON c.id = r.card_id AND c.deleted_at IS NULL
       WHERE r.deleted_at IS NULL AND c.id IS NULL
     ) LIMIT 1`,
  );
  if (brokenDependent) throw new Error(`Local ${brokenDependent.kind} "${brokenDependent.id}" references a missing card.`);

  const inconsistentLayers = await db.getFirstAsync<{ id: string }>(
    `SELECT c.id
     FROM cards c
     LEFT JOIN depth_layers l ON l.card_id = c.id AND l.deleted_at IS NULL
     WHERE c.deleted_at IS NULL
     GROUP BY c.id
     HAVING COUNT(l.id) <> c.total_layers
       OR COALESCE(MIN(l.layer_number), 0) <> 1
       OR COALESCE(MAX(l.layer_number), 0) <> c.total_layers
     LIMIT 1`,
  );
  if (inconsistentLayers) throw new Error(`Local card "${inconsistentLayers.id}" has an inconsistent page sequence.`);

  return db;
}
