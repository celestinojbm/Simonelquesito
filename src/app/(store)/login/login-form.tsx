"use client";

import { useState, useTransition } from "react";
import { loginAction } from "@/app/actions/auth";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await loginAction(formData);
          if (result && !result.ok) setError(result.message);
        });
      }}
      className="space-y-3 rounded-card border border-brand-soft bg-white p-4"
    >
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">Correo</label>
        <input
          id="email" name="email" type="email" required autoComplete="email"
          className="w-full rounded-lg border border-brand-soft px-3 py-2.5 text-sm"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">Contraseña</label>
        <input
          id="password" name="password" type="password" required autoComplete="current-password"
          className="w-full rounded-lg border border-brand-soft px-3 py-2.5 text-sm"
        />
      </div>
      {error && <p role="alert" className="text-sm font-medium text-coral-dark">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="btn w-full rounded-full bg-brand py-3 font-bold text-white hover:bg-brand-dark disabled:opacity-50"
      >
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
