import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Eye,
  ImagePlus,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Plus,
  Tag,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import Cropper from "react-easy-crop";
import { toast } from "sonner";
import {
  CampaignBubble,
  CartShippingBubble,
  FreeShippingBanner,
  ProductCard,
} from "@/components/shop/cards";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIES, formatPrice } from "@/lib/shop/catalog";
import {
  CAMPAIGN_TEMPLATES,
  type CampaignTemplateInfo,
  type ShopProduct,
  type WorkshopCampaign,
  type WorkshopProduct,
} from "@/lib/shop/campaigns";
import { cropImageToDataUrl, dataUrlToBase64, type CropAreaPixels } from "@/lib/shop/crop-image";
import {
  deleteWorkshopCampaignFn,
  deleteWorkshopProductFn,
  listWorkshopCampaignsFn,
  listWorkshopProductsFn,
  saveWorkshopCampaignFn,
  saveWorkshopProductFn,
} from "@/lib/shop-admin.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/verkstad/produkter")({
  ssr: false,
  component: WorkshopProductsPage,
});

function WorkshopProductsPage() {
  return (
    <div className="space-y-4 px-4 pt-4">
      <h1 className="text-lg font-bold text-foreground">Produkter & kampanjer</h1>
      <Tabs defaultValue="produkter">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="produkter">Produkter</TabsTrigger>
          <TabsTrigger value="kampanjer">Kampanjer</TabsTrigger>
        </TabsList>
        <TabsContent value="produkter" className="mt-4">
          <ProductsSection />
        </TabsContent>
        <TabsContent value="kampanjer" className="mt-4">
          <CampaignsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── Produkter ──

function ProductsSection() {
  const fetchProducts = useServerFn(listWorkshopProductsFn);
  const removeProduct = useServerFn(deleteWorkshopProductFn);
  const saveProduct = useServerFn(saveWorkshopProductFn);
  const queryClient = useQueryClient();

  const { data: products, isLoading } = useQuery({
    queryKey: ["workshop-products"],
    queryFn: () => fetchProducts(),
  });

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<WorkshopProduct | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["workshop-products"] });
    queryClient.invalidateQueries({ queryKey: ["shop-extras"] });
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeProduct({ data: { id } }),
    onSuccess: () => {
      toast.success("Produkten togs bort.");
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Produkten kunde inte tas bort."),
  });

  const toggleMutation = useMutation({
    mutationFn: (product: WorkshopProduct) =>
      saveProduct({
        data: {
          id: product.id,
          name: product.name,
          brand: product.brand,
          category: product.category,
          description: product.description,
          price: product.price,
          unit: product.unit,
          status: product.status === "published" ? "draft" : "published",
        },
      }),
    onSuccess: (saved) => {
      toast.success(
        saved.status === "published"
          ? "Produkten är nu publicerad och syns för kunder."
          : "Produkten är avpublicerad och dold för kunder.",
      );
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Statusen kunde inte ändras."),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Dina egna produkter i butiken. Publicerade produkter syns för kunder — utkast ser bara
        verkstaden.
      </p>
      <Button
        className="w-full rounded-full"
        onClick={() => {
          setEditing(null);
          setEditorOpen(true);
        }}
      >
        <Plus className="mr-1 h-4 w-4" /> Lägg till produkt
      </Button>

      {isLoading ? (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">Laddar produkter…</p>
        </div>
      ) : products && products.length > 0 ? (
        products.map((product) => (
          <div key={product.id} className="rounded-xl bg-card p-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Package className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-card-foreground">
                  {product.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatPrice(product.price)}
                  {product.unit ? ` · ${product.unit}` : ""}
                </p>
                <span
                  className={cn(
                    "mt-1 inline-block rounded-md px-2 py-0.5 text-[11px] font-medium",
                    product.status === "published"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700",
                  )}
                >
                  {product.status === "published" ? "Publicerad" : "Utkast"}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <button
                  type="button"
                  aria-label={`Redigera ${product.name}`}
                  onClick={() => {
                    setEditing(product);
                    setEditorOpen(true);
                  }}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Ta bort ${product.name}`}
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`Ta bort ${product.name}?`)) {
                      deleteMutation.mutate(product.id);
                    }
                  }}
                  className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <Button
              variant={product.status === "published" ? "outline" : "default"}
              size="sm"
              className="mt-2 w-full rounded-full"
              disabled={toggleMutation.isPending}
              onClick={() => toggleMutation.mutate(product)}
            >
              {product.status === "published" ? "Avpublicera" : "Publicera i butiken"}
            </Button>
          </div>
        ))
      ) : (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <Tag className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold text-card-foreground">Inga egna produkter än</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Lägg till en produkt, ladda upp en bild och publicera den i butiken.
          </p>
        </div>
      )}

      <ProductEditorDialog
        key={editing?.id ?? "new"}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        product={editing}
        onSaved={invalidate}
      />
    </div>
  );
}

function ProductEditorDialog({
  open,
  onClose,
  product,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  product: WorkshopProduct | null;
  onSaved: () => void;
}) {
  const saveProduct = useServerFn(saveWorkshopProductFn);

  const [name, setName] = useState(product?.name ?? "");
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [category, setCategory] = useState(product?.category ?? "tillbehor");
  const [unit, setUnit] = useState(product?.unit ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [description, setDescription] = useState(product?.description ?? "");

  // Bildflöde: välj fil → beskär → beskuren bild som data-URL.
  const [rawImage, setRawImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<CropAreaPixels | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);

  const priceNumber = Number(price.replace(",", "."));
  const validPrice = Number.isFinite(priceNumber) && priceNumber >= 0;

  // Förhandsvisningen använder exakt samma produktkort som kundens butik.
  const previewProduct: ShopProduct = useMemo(
    () => ({
      id: product?.id ?? "preview",
      name: name || "Produktnamn",
      brand: brand || "Sipomax",
      category: (category as ShopProduct["category"]) ?? "tillbehor",
      description: description,
      price: validPrice ? priceNumber : 0,
      unit: unit || "styck",
      imageUrl: croppedImage ?? product?.imageUrl ?? null,
      custom: true,
    }),
    [product, name, brand, category, description, priceNumber, validPrice, unit, croppedImage],
  );

  const mutation = useMutation({
    mutationFn: (status: "draft" | "published") =>
      saveProduct({
        data: {
          id: product?.id ?? null,
          name: name.trim(),
          brand: brand.trim() || null,
          category,
          description: description.trim() || null,
          price: priceNumber,
          unit: unit.trim() || null,
          status,
          ...(croppedImage
            ? { imageBase64: dataUrlToBase64(croppedImage), imageType: "image/jpeg" as const }
            : {}),
        },
      }),
    onSuccess: (saved) => {
      toast.success(
        saved.status === "published"
          ? `${saved.name} är publicerad och syns nu för kunder.`
          : `${saved.name} sparades som utkast.`,
      );
      onSaved();
      onClose();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Produkten kunde inte sparas."),
  });

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setRawImage(reader.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function applyCrop() {
    if (!rawImage || !areaPixels) return;
    try {
      setCroppedImage(await cropImageToDataUrl(rawImage, areaPixels));
      setRawImage(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bilden kunde inte beskäras.");
    }
  }

  const canSave = name.trim().length > 0 && validPrice && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? "Redigera produkt" : "Ny produkt"}</DialogTitle>
          <DialogDescription>
            Fyll i uppgifterna, beskär bilden och förhandsgranska innan du publicerar.
          </DialogDescription>
        </DialogHeader>

        {/* Bild + beskärning */}
        <div className="space-y-2">
          <Label className="text-xs">Produktbild</Label>
          {rawImage ? (
            <div className="space-y-2">
              <div className="relative h-64 w-full overflow-hidden rounded-lg bg-neutral-950">
                <Cropper
                  image={rawImage}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={(_area, pixels) => setAreaPixels(pixels)}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Zoom</span>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="w-full accent-[var(--primary)]"
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" className="flex-1 rounded-full" onClick={applyCrop}>
                  <Check className="mr-1 h-4 w-4" /> Använd beskärning
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setRawImage(null)}
                >
                  Avbryt
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {(croppedImage ?? product?.imageUrl) ? (
                <img
                  src={croppedImage ?? product?.imageUrl ?? undefined}
                  alt="Produktbild"
                  className="h-20 w-20 rounded-lg object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-muted">
                  <ImagePlus className="h-7 w-7 text-muted-foreground" />
                </div>
              )}
              <label className="cursor-pointer rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent">
                {(croppedImage ?? product?.imageUrl) ? "Byt bild" : "Välj bild"}
                <input type="file" accept="image/*" className="hidden" onChange={pickFile} />
              </label>
            </div>
          )}
        </div>

        {/* Uppgifter */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="p-name" className="text-xs">
              Namn *
            </Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-brand" className="text-xs">
              Varumärke
            </Label>
            <Input id="p-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Kategori</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-price" className="text-xs">
              Pris (kr exkl. moms) *
            </Label>
            <Input
              id="p-price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-unit" className="text-xs">
              Enhet (t.ex. 5 L)
            </Label>
            <Input id="p-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="p-desc" className="text-xs">
              Beskrivning
            </Label>
            <Textarea
              id="p-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {/* Förhandsvisning — exakt samma kort som kunden ser */}
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Eye className="h-3.5 w-3.5" /> Förhandsvisning — så ser produkten ut för kunden
          </p>
          <div className="pointer-events-none rounded-xl bg-neutral-100 p-3">
            <ProductCard product={previewProduct} />
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 rounded-full"
            disabled={!canSave}
            onClick={() => mutation.mutate("draft")}
          >
            {mutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Spara utkast
          </Button>
          <Button
            className="flex-1 rounded-full"
            disabled={!canSave}
            onClick={() => mutation.mutate("published")}
          >
            {mutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Publicera
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────── Kampanjer ──

function CampaignsSection() {
  const fetchCampaigns = useServerFn(listWorkshopCampaignsFn);
  const queryClient = useQueryClient();
  const { data: campaigns, isLoading } = useQuery({
    queryKey: ["workshop-campaigns"],
    queryFn: () => fetchCampaigns(),
  });

  const [editorTemplate, setEditorTemplate] = useState<CampaignTemplateInfo | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["workshop-campaigns"] });
    queryClient.invalidateQueries({ queryKey: ["shop-extras"] });
  }

  function existingFor(template: string): WorkshopCampaign | undefined {
    return campaigns?.find((c) => c.template === template);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Kampanjer är färdiga mallar som visas på bestämda platser i kundappen. Redigera texten,
        förhandsgranska bubblan och publicera.
      </p>
      {isLoading ? (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">Laddar kampanjer…</p>
        </div>
      ) : (
        CAMPAIGN_TEMPLATES.map((template) => {
          const existing = existingFor(template.template);
          return (
            <div key={template.template} className="rounded-xl bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-card-foreground">{template.name}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-primary">
                    <MapPin className="h-3 w-3 shrink-0" /> {template.placementLabel}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium",
                    existing?.active
                      ? "bg-emerald-100 text-emerald-700"
                      : existing
                        ? "bg-amber-100 text-amber-700"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {existing?.active ? "Aktiv" : existing ? "Pausad" : "Ej skapad"}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{template.description}</p>
              <Button
                variant={existing ? "outline" : "default"}
                size="sm"
                className="mt-3 w-full rounded-full"
                onClick={() => setEditorTemplate(template)}
              >
                {existing ? "Redigera kampanj" : "Skapa kampanj"}
              </Button>
            </div>
          );
        })
      )}

      {editorTemplate && (
        <CampaignEditorDialog
          key={editorTemplate.template}
          template={editorTemplate}
          existing={existingFor(editorTemplate.template) ?? null}
          onClose={() => setEditorTemplate(null)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

function CampaignEditorDialog({
  template,
  existing,
  onClose,
  onSaved,
}: {
  template: CampaignTemplateInfo;
  existing: WorkshopCampaign | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const saveCampaign = useServerFn(saveWorkshopCampaignFn);
  const removeCampaign = useServerFn(deleteWorkshopCampaignFn);

  const [title, setTitle] = useState(existing?.title ?? template.defaultTitle);
  const [message, setMessage] = useState(existing?.message ?? template.defaultMessage);
  const [minOrder, setMinOrder] = useState(String(existing?.minOrder ?? 2500));
  const [active, setActive] = useState(existing?.active ?? true);
  // Exempelvarukorg för att demonstrera frifrakt-uträkningen i förhandsvisningen.
  const [exampleTotal, setExampleTotal] = useState(1200);

  const minOrderNumber = Number(minOrder.replace(",", "."));
  const validMinOrder =
    !template.hasMinOrder || (Number.isFinite(minOrderNumber) && minOrderNumber > 0);

  const previewCampaign: WorkshopCampaign = {
    id: existing?.id ?? "preview",
    template: template.template,
    title: title || template.defaultTitle,
    message: message || template.defaultMessage,
    minOrder: template.hasMinOrder ? (validMinOrder ? minOrderNumber : 0) : null,
    active,
    updatedAt: new Date().toISOString(),
  };

  const saveMutation = useMutation({
    mutationFn: (activeState: boolean) =>
      saveCampaign({
        data: {
          id: existing?.id ?? null,
          template: template.template,
          title: title.trim(),
          message: message.trim(),
          minOrder: template.hasMinOrder ? minOrderNumber : null,
          active: activeState,
        },
      }),
    onSuccess: (saved) => {
      toast.success(
        saved.active
          ? "Kampanjen är publicerad och syns nu för kunder."
          : "Kampanjen sparades som pausad.",
      );
      onSaved();
      onClose();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Kampanjen kunde inte sparas."),
  });

  const deleteMutation = useMutation({
    mutationFn: () => removeCampaign({ data: { id: existing!.id } }),
    onSuccess: () => {
      toast.success("Kampanjen togs bort.");
      onSaved();
      onClose();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Kampanjen kunde inte tas bort."),
  });

  const canSave =
    title.trim().length > 0 &&
    message.trim().length > 0 &&
    validMinOrder &&
    !saveMutation.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          <DialogDescription className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" /> {template.placementLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="c-title" className="text-xs">
              Rubrik
            </Label>
            <Input id="c-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-message" className="text-xs">
              Text
            </Label>
            <Textarea
              id="c-message"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            {template.hasMinOrder && (
              <p className="text-[11px] text-muted-foreground">
                Tips: skriv <code>{"{{belopp}}"}</code> i texten så ersätts det med minimibeloppet.
              </p>
            )}
          </div>
          {template.hasMinOrder && (
            <div className="space-y-1.5">
              <Label htmlFor="c-min" className="text-xs">
                Minimibelopp för fri frakt (kr)
              </Label>
              <Input
                id="c-min"
                inputMode="numeric"
                value={minOrder}
                onChange={(e) => setMinOrder(e.target.value)}
              />
            </div>
          )}
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-xs text-muted-foreground">Aktiv (syns för kunder)</span>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
        </div>

        {/* Förhandsvisning — samma komponenter som kundappen renderar */}
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Eye className="h-3.5 w-3.5" /> Förhandsvisning — så ser bubblan ut för kunden
          </p>
          {template.template === "free_shipping" ? (
            <div className="space-y-3 rounded-xl bg-neutral-100 p-3">
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                  I varukorgen (räknas ut från kundens varukorg):
                </p>
                <CartShippingBubble
                  minOrder={validMinOrder ? minOrderNumber : 0}
                  title={title}
                  total={exampleTotal}
                />
                <div className="mt-2 flex items-center gap-2">
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    Testa: kundens varukorg {formatPrice(exampleTotal)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1000, validMinOrder ? minOrderNumber * 1.5 : 4000)}
                    step={50}
                    value={exampleTotal}
                    onChange={(e) => setExampleTotal(Number(e.target.value))}
                    className="w-full accent-[var(--primary)]"
                  />
                </div>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">På startsidan:</p>
                <FreeShippingBanner campaign={previewCampaign} />
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-neutral-100 p-3">
              <CampaignBubble campaign={previewCampaign} />
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {existing && (
            <Button
              variant="outline"
              className="rounded-full"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (window.confirm("Ta bort kampanjen?")) deleteMutation.mutate();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            className="flex-1 rounded-full"
            disabled={!canSave}
            onClick={() => saveMutation.mutate(active)}
          >
            {saveMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {active ? "Publicera kampanj" : "Spara pausad"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
