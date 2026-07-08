import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, identityVerifications } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { ageFromBirthDate } from "@/modules/accounts/identity";
import { IdentidadesClient } from "./identidades-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verificación de identidad · Admin" };

export default async function IdentidadesPage() {
  await requirePermission("customers.manage");

  const rows = await db
    .select({
      id: identityVerifications.id,
      customerName: customers.fullName,
      phone: customers.phone,
      documentId: identityVerifications.documentId,
      birthDate: identityVerifications.birthDate,
      frontImageUrl: identityVerifications.frontImageUrl,
      createdAt: identityVerifications.createdAt,
    })
    .from(identityVerifications)
    .innerJoin(customers, eq(identityVerifications.customerId, customers.id))
    .where(eq(identityVerifications.status, "pending"))
    .orderBy(desc(identityVerifications.createdAt));

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-extrabold text-ink">🪪 Verificación de identidad</h1>
      <p className="mb-4 text-sm text-ink-soft">
        Cédulas enviadas por clientes que quieren pedir a crédito en línea. Verifica que la foto
        coincida y que sea mayor de 18 antes de aprobar. Al aprobar, se habilita su cupo de Fiado.
      </p>
      <IdentidadesClient
        rows={rows.map((r) => ({
          ...r,
          age: ageFromBirthDate(r.birthDate),
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
