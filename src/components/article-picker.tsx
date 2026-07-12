import { useState, useRef, useEffect, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { searchArticles, createFortnoxArticle, updateFortnoxArticle, deleteFortnoxArticle } from "@/lib/invoice.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Search, Plus, Trash2, Loader2, X, Clock } from "lucide-react";
import { toast } from "sonner";
import { type ArticleLine, lineSubtotal, articlesSubtotal, formatSek } from "@/lib/articles";
import { rankArticles } from "@/lib/customer-match";

const RECENT_ARTICLES_KEY = "fortnox-recent-articles";
const MAX_RECENT = 10;
const PENDING_ARTICLE_KEY = "fortnox-pending-article";
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PendingArticle { articleNumber: string; createdAt: number }

function getPendingArticle(): PendingArticle | null {
  try { return JSON.parse(localStorage.getItem(PENDING_ARTICLE_KEY) ?? "null"); } catch { return null; }
}
function setPendingArticle(a: PendingArticle | null) {
  if (a) localStorage.setItem(PENDING_ARTICLE_KEY, JSON.stringify(a));
  else localStorage.removeItem(PENDING_ARTICLE_KEY);
}
function cleanupPendingViaBeacon(articleNumber: string) {
  try {
    navigator.sendBeacon(
      "/api/fortnox-article-cleanup",
      new Blob([JSON.stringify({ articleNumber })], { type: "application/json" }),
    );
  } catch { /* best-effort */ }
}

interface ArticleResult {
  articleNumber: string;
  description: string;
  salesPrice: number | null;
  unit: string | null;
  vat: number | null;
}

interface CreateForm {
  articleNumber: string;
  description: string;
  salesPrice: string;
  unit: string;
  vat: string;
}

function getRecentArticleNumbers(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_ARTICLES_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function addRecentArticle(articleNumber: string) {
  const recent = getRecentArticleNumbers().filter((n) => n !== articleNumber);
  recent.unshift(articleNumber);
  localStorage.setItem(RECENT_ARTICLES_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

function sortByRecent(results: ArticleResult[]): ArticleResult[] {
  const recent = getRecentArticleNumbers();
  if (!recent.length) return results;
  const recentSet = new Set(recent);
  const recentOnes = recent
    .map((num) => results.find((a) => a.articleNumber === num))
    .filter(Boolean) as ArticleResult[];
  const rest = results.filter((a) => !recentSet.has(a.articleNumber));
  return [...recentOnes, ...rest];
}

export function ArticlePicker({
  value,
  onChange,
  addToLabel = "fakturan",
}: {
  value: ArticleLine[];
  onChange: (lines: ArticleLine[]) => void;
  /** Noun phrase used in "Lägg till på …" — e.g. "fakturan" or "offerten". */
  addToLabel?: string;
}) {
  const search = useServerFn(searchArticles);
  const createArticle = useServerFn(createFortnoxArticle);
  const updateArticle = useServerFn(updateFortnoxArticle);
  const deleteArticle = useServerFn(deleteFortnoxArticle);
  const [query, setQuery] = useState("");
  const [allArticles, setAllArticles] = useState<ArticleResult[]>([]);
  const [filteredResults, setFilteredResults] = useState<ArticleResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>({
    articleNumber: "", description: "", salesPrice: "", unit: "", vat: "25",
  });
  // Post-create review state: article exists in Fortnox, user can rename/edit before adding
  const [reviewArticle, setReviewArticle] = useState<{
    originalNumber: string;
    form: CreateForm;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const allArticlesFetched = useRef(false);
  const pendingArticleRef = useRef<string | null>(null);

  // On mount: delete any pending article left over from a previous session/reload
  useEffect(() => {
    const stale = getPendingArticle();
    if (!stale) return;
    setPendingArticle(null);
    if (Date.now() - stale.createdAt > 0) {
      deleteArticle({ data: { articleNumber: stale.articleNumber } }).catch(() => {});
    }
  }, []);

  // On unmount: delete pending article (covers in-app navigation away)
  useEffect(() => {
    return () => {
      const num = pendingArticleRef.current;
      if (!num) return;
      setPendingArticle(null);
      deleteArticle({ data: { articleNumber: num } }).catch(() => {});
    };
  }, []);

  // beforeunload: covers tab close / hard navigation (sendBeacon survives page unload)
  useEffect(() => {
    function onBeforeUnload() {
      const num = pendingArticleRef.current;
      if (!num) return;
      setPendingArticle(null);
      cleanupPendingViaBeacon(num);
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const fetchAllArticles = useCallback(async () => {
    if (allArticlesFetched.current) {
      setFilteredResults(sortByRecent(allArticles));
      setOpen(true);
      return;
    }
    setSearching(true);
    try {
      const r = (await search({ data: { query: "" } })) as { results: ArticleResult[] };
      allArticlesFetched.current = true;
      setAllArticles(r.results);
      setFilteredResults(sortByRecent(r.results));
      setOpen(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Kunde inte hämta artiklar");
    } finally {
      setSearching(false);
    }
  }, [allArticles, search]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    // Empty query → show recent first (browse). Once the full list is loaded,
    // filter + rank locally so typing instantly reorders by best match
    // (recency only breaks ties).
    if (allArticlesFetched.current) {
      setFilteredResults(
        q ? rankArticles(allArticles, q, getRecentArticleNumbers()) : sortByRecent(allArticles),
      );
      setOpen(true);
      return;
    }
    if (!q) return;
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = (await search({ data: { query: q } })) as { results: ArticleResult[] };
        // Merge new results into allArticles cache
        setAllArticles((prev) => {
          const map = new Map(prev.map((a) => [a.articleNumber, a]));
          r.results.forEach((a) => map.set(a.articleNumber, a));
          return [...map.values()];
        });
        setFilteredResults(rankArticles(r.results, q, getRecentArticleNumbers()));
        setOpen(true);
      } catch (e: any) {
        toast.error(e?.message ?? "Kunde inte söka artiklar");
        setFilteredResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, allArticles]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (boxRef.current?.contains(target)) return;
      if (contentRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function addArticle(a: ArticleResult) {
    addRecentArticle(a.articleNumber);
    onChange([...value, {
      article_number: a.articleNumber,
      description: a.description || a.articleNumber,
      quantity: 1,
      unit_price: a.salesPrice ?? 0,
      vat: a.vat ?? 25,
    }]);
    setQuery(""); setFilteredResults([]); setOpen(false);
  }

  function addCustomLine() {
    onChange([...value, { article_number: null, description: "", quantity: 1, unit_price: 0, vat: 25 }]);
  }

  async function openCreateForm() {
    setShowCreate(true);
    setOpen(false);
    setCreating(true);
    try {
      // Create immediately so we get the Fortnox-assigned article number right away
      const result = await createArticle({
        data: { description: "Ny artikel" },
      });
      allArticlesFetched.current = false;
      pendingArticleRef.current = result.articleNumber;
      setPendingArticle({ articleNumber: result.articleNumber, createdAt: Date.now() });
      setReviewArticle({
        originalNumber: result.articleNumber,
        form: { articleNumber: result.articleNumber, description: "", salesPrice: "", unit: "", vat: "25" },
      });
    } catch (err: any) {
      toast.error(err?.message ?? "Kunde inte skapa artikel");
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  }

  function submitReviewOnEnter(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); handleReviewDone(); }
  }

  async function handleReviewDone(e?: React.SyntheticEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (!reviewArticle) return;
    if (!reviewArticle.form.description.trim()) {
      toast.error("Ange en beskrivning för artikeln");
      return;
    }
    setSaving(true);
    try {
      const f = reviewArticle.form;
      const newNum = f.articleNumber.trim();
      const numberChanged = newNum && newNum !== reviewArticle.originalNumber;
      let finalNumber = reviewArticle.originalNumber;

      if (numberChanged) {
        // Try to rename via PUT first
        try {
          const updated = await updateArticle({
            data: {
              currentArticleNumber: reviewArticle.originalNumber,
              articleNumber: newNum,
              description: f.description.trim() || undefined,
              salesPrice: f.salesPrice ? Number(f.salesPrice) : undefined,
              unit: f.unit || undefined,
              vat: f.vat ? Number(f.vat) : undefined,
            },
          });
          finalNumber = updated.articleNumber;
        } catch {
          // PUT rename failed — delete and recreate with the desired number
          await deleteArticle({ data: { articleNumber: reviewArticle.originalNumber } });
          const recreated = await createArticle({
            data: {
              articleNumber: newNum,
              description: f.description.trim(),
              unit: f.unit || undefined,
              vat: f.vat ? Number(f.vat) : 25,
            },
          });
          finalNumber = recreated.articleNumber;
          allArticlesFetched.current = false;
          // Set price via PUT since POST doesn't accept SalesPrice
          if (f.salesPrice) {
            await updateArticle({
              data: { currentArticleNumber: finalNumber, salesPrice: Number(f.salesPrice) },
            }).catch(() => {});
          }
        }
      } else {
        // No number change — PUT to save all edits including price
        const salesPrice = f.salesPrice ? Number(f.salesPrice) : undefined;
        try {
          await updateArticle({
            data: {
              currentArticleNumber: reviewArticle.originalNumber,
              description: f.description.trim() || undefined,
              salesPrice,
              unit: f.unit || undefined,
              vat: f.vat ? Number(f.vat) : undefined,
            },
          });
        } catch {
          // If SalesPrice is also read-only on PUT, retry without it
          await updateArticle({
            data: {
              currentArticleNumber: reviewArticle.originalNumber,
              description: f.description.trim() || undefined,
              unit: f.unit || undefined,
              vat: f.vat ? Number(f.vat) : undefined,
            },
          });
        }
      }

      pendingArticleRef.current = null;
      setPendingArticle(null);
      addRecentArticle(finalNumber);
      onChange([...value, {
        article_number: finalNumber,
        description: f.description.trim() || finalNumber,
        quantity: 1,
        unit_price: f.salesPrice ? Number(f.salesPrice) : 0,
        vat: f.vat ? Number(f.vat) : 25,
      }]);
      setReviewArticle(null);
      setShowCreate(false);
      setQuery("");
    } catch (err: any) {
      toast.error(err?.message ?? "Kunde inte spara artikel");
    } finally {
      setSaving(false);
    }
  }

  function updateLine(index: number, patch: Partial<ArticleLine>) {
    onChange(value.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  const subtotal = articlesSubtotal(value);
  const recentNums = new Set(getRecentArticleNumbers());

  return (
    <div className="space-y-3">
      {/* Search */}
      <div ref={boxRef} className="relative">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverAnchor asChild>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => { if (!open) fetchAllArticles(); }}
                onBlur={() => {
                  // On mobile, dismissing the keyboard blurs the input without any
                  // DOM click for our outside-click listener to catch, which used
                  // to leave the popover open while the page scrolled back —
                  // making it appear to "float" away from the input. Close it
                  // here too, unless focus moved into the dropdown itself
                  // (mousedown on its buttons below prevents that from stealing
                  // focus in the first place, so this only fires on a real blur).
                  window.setTimeout(() => {
                    if (contentRef.current?.contains(document.activeElement)) return;
                    setOpen(false);
                  }, 0);
                }}
                placeholder="Sök artikel – namn, nummer eller innehåll"
                className="pl-9 h-10"
              />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </PopoverAnchor>
          <PopoverContent
            ref={contentRef}
            align="start"
            sideOffset={4}
            collisionPadding={8}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            className="z-30 w-(--radix-popover-trigger-width) p-0 rounded-md border bg-popover shadow-md flex flex-col max-h-(--radix-popover-content-available-height) overflow-hidden"
          >
            <div className="overflow-y-auto overscroll-contain flex-1 min-h-0">
              {filteredResults.length === 0 ? (
                <div className="px-3 py-3">
                  <p className="text-sm text-muted-foreground">
                    {searching ? "Söker…" : "Inga artiklar matchade sökningen."}
                  </p>
                </div>
              ) : (
                <ul className="divide-y">
                  {filteredResults.map((a) => (
                    <li key={a.articleNumber}>
                      <button
                        type="button"
                        onClick={() => addArticle(a)}
                        className="w-full text-left px-3 py-2.5 sm:py-2 hover:bg-muted/60 active:bg-muted/80 transition-colors flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          {recentNums.has(a.articleNumber) && (
                            <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{a.description || "(utan namn)"}</p>
                            <p className="text-xs text-muted-foreground">
                              Art.nr {a.articleNumber}{a.unit ? ` · ${a.unit}` : ""}
                            </p>
                          </div>
                        </div>
                        <span className="text-sm tabular-nums text-muted-foreground shrink-0">
                          {a.salesPrice != null ? `${formatSek(a.salesPrice)} kr` : "—"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              onClick={openCreateForm}
              className="w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors flex items-center gap-2 text-primary border-t shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="text-sm font-medium">Skapa ny artikel i Fortnox</span>
            </button>
          </PopoverContent>
        </Popover>
      </div>

      {/* Loading state while article is being created in Fortnox */}
      {showCreate && !reviewArticle && (
        <div className="rounded-lg border bg-muted/30 p-4 flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Skapar artikel i Fortnox…
        </div>
      )}

      {/* Edit created article — seamless, no "article was created" messaging */}
      {reviewArticle && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Ny artikel i Fortnox</p>
            <button type="button" onClick={() => {
              if (reviewArticle) deleteArticle({ data: { articleNumber: reviewArticle.originalNumber } }).catch(() => {});
              pendingArticleRef.current = null;
              setPendingArticle(null);
              setReviewArticle(null);
              setShowCreate(false);
            }} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">Artikelnummer</Label>
              <Input
                autoFocus
                value={reviewArticle.form.articleNumber}
                onChange={e => setReviewArticle(r => r ? { ...r, form: { ...r.form, articleNumber: e.target.value } } : r)}
                onKeyDown={submitReviewOnEnter}
                placeholder="Artikelnummer"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Beskrivning *</Label>
              <Input
                value={reviewArticle.form.description}
                onChange={e => setReviewArticle(r => r ? { ...r, form: { ...r.form, description: e.target.value } } : r)}
                onKeyDown={submitReviewOnEnter}
                placeholder="Artikelns namn"
                className="h-8 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Enhet</Label>
                <Select
                  value={reviewArticle.form.unit}
                  onValueChange={v => setReviewArticle(r => r ? { ...r, form: { ...r.form, unit: v === "__none__" ? "" : v } } : r)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Välj enhet…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    <SelectItem value="förp">förp – förpackning</SelectItem>
                    <SelectItem value="h">h – timmar</SelectItem>
                    <SelectItem value="km">km – Kilometer</SelectItem>
                    <SelectItem value="st">st – styck</SelectItem>
                    <SelectItem value="utl">utl – Utlägg</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pris (ex moms)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={reviewArticle.form.salesPrice}
                  onChange={e => setReviewArticle(r => r ? { ...r, form: { ...r.form, salesPrice: e.target.value } } : r)}
                  onKeyDown={submitReviewOnEnter}
                  placeholder="0.00"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Moms %</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={reviewArticle.form.vat}
                  onChange={e => setReviewArticle(r => r ? { ...r, form: { ...r.form, vat: e.target.value } } : r)}
                  onKeyDown={submitReviewOnEnter}
                  placeholder="25"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="button" size="sm" disabled={saving} className="flex-1" onClick={() => handleReviewDone()}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Lägg till på {addToLabel}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  if (reviewArticle) deleteArticle({ data: { articleNumber: reviewArticle.originalNumber } }).catch(() => {});
                  pendingArticleRef.current = null;
                  setPendingArticle(null);
                  setReviewArticle(null);
                  setShowCreate(false);
                }}
              >
                Avbryt
              </Button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={addCustomLine}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus className="h-3.5 w-3.5" /> Lägg till egen rad
      </button>

      {/* Selected lines */}
      {value.length > 0 ? (
        <div className="rounded-md border divide-y">
          {value.map((line, i) => (
            <div key={i} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex-1 min-w-0">
                <Input
                  value={line.description}
                  onChange={(e) => updateLine(i, { description: e.target.value })}
                  placeholder="Beskrivning"
                  className="h-8"
                />
                {line.article_number && (
                  <p className="text-[11px] text-muted-foreground mt-1">Art.nr {line.article_number}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value === "" ? 0 : Number(e.target.value) })}
                    className="h-8 w-14 text-center px-1"
                    aria-label="Antal"
                  />
                  <span className="text-muted-foreground text-sm">×</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={line.unit_price}
                    onChange={(e) => updateLine(i, { unit_price: e.target.value === "" ? 0 : Number(e.target.value) })}
                    className="h-8 w-24 text-right px-2"
                    aria-label="Pris (exkl. moms)"
                  />
                </div>
                <span className="flex-1 text-right text-sm tabular-nums">
                  {formatSek(lineSubtotal(line))} kr
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeLine(i)}
                  aria-label="Ta bort rad"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between px-3 py-2.5 bg-muted/30">
            <span className="text-sm font-medium">Summa (exkl. moms)</span>
            <span className="text-sm font-semibold tabular-nums">{formatSek(subtotal)} kr</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Sök efter artiklar ovan eller lägg till en egen rad.
        </p>
      )}
    </div>
  );
}
