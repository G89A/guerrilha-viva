-- Fecha uma brecha encontrada pelo red team do SPRINT 1.
--
-- `contact_consents` tem unique em (contact_id, channel), sem workspace. Um
-- serviço que recebesse o contact_id de outro tenant atualizaria o registro
-- alheio. A foreign key composta faz o PostgreSQL recusar qualquer linha cujo
-- workspace não seja o do próprio contato.
--
-- Aditiva: linhas existentes já satisfazem a nova constraint, porque o
-- workspace do consentimento sempre foi copiado do contato.

-- DropForeignKey
ALTER TABLE "contact_consents" DROP CONSTRAINT "contact_consents_contact_id_fkey";

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_workspace_id_contact_id_fkey" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "contacts"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

