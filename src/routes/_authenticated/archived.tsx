import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listArchivedJobs } from "@/lib/jobs.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Archive, Car } from "lucide-react";
import { statusLabel, statusVariant } from "@/lib/status";

export const Route = createFileRoute("/_authenticated/archived")({
  component: ArchivedPage,
});

function ArchivedPage() {
  const fetchJobs = useServerFn(listArchivedJobs);
  const { data, isLoading } = useQuery({
    queryKey: ["jobs", "archived"],
    queryFn: () => fetchJobs(),
  });

  return (
    <main className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link to="/dashboard"><ArrowLeft className="h-4 w-4 mr-1" /> Tillbaka</Link>
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Archive className="h-6 w-6" /> Avklarade jobb</h1>
          <p className="text-sm text-muted-foreground">Bilar som har hämtats upp och fakturerats.</p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Laddar...</p>
      ) : !data?.jobs.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Archive className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">Inga avklarade jobb än.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {data.jobs.map((job) => (
            <Link key={job.id} to="/jobs/$id" params={{ id: job.id }} className="block">
              <Card className="hover:border-primary/50 transition-colors">
                <CardContent className="py-4 flex items-center gap-4">
                  <div className="h-12 w-12 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Car className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold truncate">{job.registration_number}</p>
                      <span className="text-sm text-muted-foreground truncate">
                        {[job.vehicle_make, job.vehicle_model].map(v => v?.replace(/\s*uppgift saknas.?\s*/gi, "").trim() || null).filter(Boolean).join(" ")}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{job.customer_name}</p>
                  </div>
                  <Badge variant={statusVariant(job.current_status)}>{statusLabel(job.current_status)}</Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
