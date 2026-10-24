CREATE TABLE `workspace_deletion_fences` (
	`workspace_id` text PRIMARY KEY,
	`token` text NOT NULL,
	CONSTRAINT `fk_workspace_deletion_fences_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
