import { LoginForm } from "./login-form";
import { isDemoEnabled } from "@/lib/auth/demo";

// Se evalúa por request (no se hornea en build): así el bloque demo depende del
// entorno REAL del despliegue, no del entorno de compilación.
export const dynamic = "force-dynamic";
export const metadata = { title: "Ingresar" };

export default function LoginPage() {
  // P0: las credenciales demo SOLO se muestran cuando el modo demo está
  // habilitado (nunca en producción). En producción no aparecen en el HTML.
  const showDemo = isDemoEnabled();
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-4 text-center text-xl font-extrabold text-ink">Ingresar</h1>
      <LoginForm />
      {showDemo && (
        <div className="mt-6 rounded-card border border-brand-soft bg-white p-4 text-xs text-ink-soft">
          <p className="mb-1 font-bold text-ink">Cuentas de demostración (contraseña: demo1234)</p>
          <ul className="space-y-0.5">
            <li>owner@marketcastilla.demo — propietario</li>
            <li>admin@marketcastilla.demo — administrador</li>
            <li>cajero@marketcastilla.demo — cajero</li>
            <li>preparador@marketcastilla.demo — preparador</li>
            <li>domiciliario@marketcastilla.demo — domiciliario</li>
            <li>contador@marketcastilla.demo — contador (solo lectura)</li>
            <li>agencia@marketcastilla.demo — admin técnico</li>
            <li>cliente@marketcastilla.demo — cliente</li>
          </ul>
        </div>
      )}
    </div>
  );
}
