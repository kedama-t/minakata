-- agent_activity に agent_name カラムを追加。
-- actor はハーネス由来の識別子で、agent_name はスキルが自己申告する論理名。
ALTER TABLE agent_activity ADD COLUMN agent_name TEXT;
