ALTER TABLE public.form_blocks DROP CONSTRAINT form_blocks_block_type_check;
ALTER TABLE public.form_blocks ADD CONSTRAINT form_blocks_block_type_check
CHECK (block_type = ANY (ARRAY[
  'text','email','phone','number','textarea','select','multi_select',
  'yes_no','scale','conditional','score','tag','hidden_field',
  'ai_question','ai_followup','welcome_screen','end_screen','video_embed'
]));