-- OpenCode on GLM-5.2 becomes everyone's default, once. It runs a single time
-- on deploy; anyone can change their own default in Settings, or a workspace's
-- harness, afterwards.

-- Saved per-user defaults had pinned people to the free opencode/big-pickle,
-- or to Claude. Every other setting is kept. A settings value that is not a
-- JSON object (NULL or JSON null) starts from {}: `'null'::jsonb || {...}`
-- would produce an array, not an object.
UPDATE "User"
SET "settings" =
  (CASE WHEN jsonb_typeof("settings") = 'object' THEN "settings" ELSE '{}'::jsonb END)
  || '{"defaultAgent": "opencode", "defaultModel": "opencode-go/glm-5.2"}'::jsonb;

-- Every existing workspace was created with agent 'claude', which is what new
-- chats in it started on.
UPDATE "Workspace" SET "agent" = 'opencode', "model" = 'opencode-go/glm-5.2';

-- New workspaces default to OpenCode at the column level as well.
ALTER TABLE "Workspace" ALTER COLUMN "agent" SET DEFAULT 'opencode';
