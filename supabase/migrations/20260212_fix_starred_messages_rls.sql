-- 1. Force Enable Security on the Table
ALTER TABLE public.starred_messages ENABLE ROW LEVEL SECURITY;

-- 2. Grant Basic Table Access to Authenticated Users
GRANT ALL ON public.starred_messages TO authenticated;
GRANT ALL ON public.starred_messages TO service_role;

-- 3. CLEANUP: Drop any existing policies to prevent conflicts
DROP POLICY IF EXISTS "Users can insert their own stars" ON public.starred_messages;
DROP POLICY IF EXISTS "Users can delete their own stars" ON public.starred_messages;
DROP POLICY IF EXISTS "Users can view their own stars" ON public.starred_messages;
DROP POLICY IF EXISTS "Users can insert own starred messages" ON public.starred_messages;
DROP POLICY IF EXISTS "Users can delete own starred messages" ON public.starred_messages;
DROP POLICY IF EXISTS "Users can read own starred messages" ON public.starred_messages;

-- 4. POLICY: Allow INSERT (Starring)
-- Logic: You can only insert if the user_id in the row matches your auth.uid()
CREATE POLICY "Users can insert their own stars"
ON public.starred_messages
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 5. POLICY: Allow DELETE (Unstarring)
-- Logic: You can only delete if the user_id in the row matches your auth.uid()
CREATE POLICY "Users can delete their own stars"
ON public.starred_messages
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- 6. POLICY: Allow SELECT (Viewing Sidebar)
-- Logic: You can only see rows where user_id matches your auth.uid()
CREATE POLICY "Users can view their own stars"
ON public.starred_messages
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
