/**
 * Phase 0 placeholder. Its only job is to prove that the pipeline from local
 * commit to live Vercel deployment works before any feature exists. The real
 * application shell replaces it in Phase 1.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Phase 0
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          NotebookLM Clone
        </h1>
        <p className="text-balance text-muted-foreground">
          Quellengebundener Dokumenten-Chat mit erzwungener Mandantentrennung.
          Das Fundament steht: Next.js, Tailwind, Drizzle, Neon, CI und
          Deployment. Die Anwendung folgt in den nächsten Phasen.
        </p>
      </div>
      <div className="border-t border-border pt-6">
        <a
          className="font-mono text-sm text-foreground underline underline-offset-4 hover:no-underline"
          href="/api/health"
        >
          /api/health
        </a>
      </div>
    </main>
  );
}
