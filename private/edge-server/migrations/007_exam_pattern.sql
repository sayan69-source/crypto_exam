-- 007 — the paper's SHAPE, at the centre (§ exam pattern)
--
-- The terminal has to know what to DRAW before it can draw anything: whether a
-- section is single-choice, multi-choice or numeric entry, how long the paper
-- runs, and what each section is worth. Without it a terminal can only assume
-- every exam is four-option MCQ — which is the assumption the pattern exists to
-- remove, and which silently produces the wrong interface for a JEE numeric
-- section rather than an error anyone would notice.
--
-- Carried in the provisioning bundle beside the sealed paper, so a centre that
-- has the questions also has the rules for presenting and marking them. It
-- reveals nothing: a pattern says there are twenty questions worth +4/-1, never
-- what any of them asks.
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS pattern JSONB,
  ADD COLUMN IF NOT EXISTS total_questions INTEGER;

COMMENT ON COLUMN exams.pattern IS
  'ExamPattern.to_dict() from the public platform: sections, question types, '
  'marks and tolerances. Drives what the terminal renders and what the scorer '
  'applies. NULL means the shape never arrived and the terminal must refuse '
  'rather than guess.';
