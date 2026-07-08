import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { payments, orders } from "@/db/schema";
import { formatCop } from "@/lib/format";
import { SandboxDecision } from "./sandbox-decision";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pasarela de pago (sandbox)" };

export default async function SandboxPaymentPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const payment = await db.query.payments.findFirst({ where: eq(payments.providerRef, ref) });
  if (!payment) notFound();
  const order = await db.query.orders.findFirst({ where: eq(orders.id, payment.orderId) });
  if (!order) notFound();

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-card border-2 border-dashed border-ink/20 bg-white p-6 text-center">
        <p className="text-xs font-bold tracking-widest text-ink-soft uppercase">Pasarela sandbox · demo</p>
        <h1 className="mt-2 text-xl font-extrabold text-ink">Pago del pedido {order.number}</h1>
        <p className="mt-1 text-3xl font-extrabold text-brand-dark">{formatCop(payment.amountCop)}</p>
        <p className="mt-2 text-sm text-ink-soft">
          Esta pantalla simula la pasarela real (Wompi / Mercado Pago). Elige el resultado del pago;
          la confirmación viaja por un <strong>webhook firmado</strong> hasta la tienda, igual que en producción.
        </p>
        {payment.status === "pending" ? (
          <SandboxDecision providerRef={ref} orderId={order.id} />
        ) : (
          <p className="mt-4 rounded-card bg-brand-soft p-3 font-semibold text-brand-dark">
            Este pago ya fue procesado ({payment.status}).{" "}
            <a href={`/pedido/${order.id}`} className="underline">Ver pedido</a>
          </p>
        )}
      </div>
    </div>
  );
}
