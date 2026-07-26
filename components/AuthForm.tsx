"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export function AuthForm() {
  const { login, register, logout, user, isAuthenticated, isLoading, error, loading } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  if (isAuthenticated && user) {
    return (
      <div className="flex items-center gap-4 p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
        <div className="flex-1">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Logged in as</p>
          <p className="font-medium">{user.name || user.email}</p>
        </div>
        <button
          onClick={logout}
          className="px-4 py-2 text-sm bg-zinc-200 dark:bg-zinc-700 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
        >
          Sign Out
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 text-center text-zinc-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
      <h2 className="text-lg font-semibold mb-4">
        {isRegister ? "Create Account" : "Sign In"}
      </h2>

      {error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-sm">
          {error}
        </div>
      )}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (isRegister) {
            await register(email, password, name);
          } else {
            await login(email, password);
          }
        }}
        className="space-y-3"
      >
        {isRegister && (
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-900 text-sm"
            required
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-900 text-sm"
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-900 text-sm"
          required
          minLength={6}
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded font-medium text-sm hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-50"
        >
          {loading ? "Please wait..." : isRegister ? "Register" : "Sign In"}
        </button>
      </form>

      <div className="mt-3 text-center">
        <button
          onClick={() => setIsRegister(!isRegister)}
          className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          {isRegister
            ? "Already have an account? Sign in"
            : "Don't have an account? Register"}
        </button>
      </div>

      <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-700">
        <p className="text-xs text-zinc-500 mb-2">Quick login with test accounts:</p>
        <div className="flex gap-2 flex-wrap">
          {["alice@example.com", "bob@example.com", "charlie@example.com"].map(
            (testEmail) => (
              <button
                key={testEmail}
                onClick={() => {
                  setEmail(testEmail);
                  setPassword("password123");
                }}
                className="text-xs px-2 py-1 bg-zinc-200 dark:bg-zinc-700 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600"
              >
                {testEmail.split("@")[0]}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
