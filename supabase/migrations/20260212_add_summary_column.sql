-- 1. Add the summary column
ALTER TABLE public.starred_messages
ADD COLUMN IF NOT EXISTS summary TEXT;

-- 2. Backfill: Generate summaries for existing stars
UPDATE public.starred_messages AS sm
SET summary = CASE
  WHEN prepared.source_text = '' THEN 'Saved Memory'
  WHEN prepared.word_count > 5 THEN prepared.first_five || '...'
  ELSE prepared.first_five
END
FROM (
  SELECT
    id,
    trim(coalesce(nullif(user_context, ''), snapshot_content, '')) AS source_text,
    array_to_string(
      (regexp_split_to_array(trim(coalesce(nullif(user_context, ''), snapshot_content, '')), E'\\s+'))[1:5],
      ' '
    ) AS first_five,
    cardinality(regexp_split_to_array(trim(coalesce(nullif(user_context, ''), snapshot_content, '')), E'\\s+')) AS word_count
  FROM public.starred_messages
) AS prepared
WHERE sm.id = prepared.id
  AND (sm.summary IS NULL OR btrim(sm.summary) = '');

-- 3. Refresh Schema Cache
NOTIFY pgrst, 'reload schema';
