import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface Props {
  open: boolean;
  title: string;
  placeholder: string;
  withCheckout?: boolean;
  onSubmit: (name: string, checkout: boolean) => void;
  onClose: () => void;
}

export function NameDialog({ open, title, placeholder, withCheckout, onSubmit, onClose }: Props) {
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);

  useEffect(() => {
    if (open) {
      setName("");
      setCheckout(true);
    }
  }, [open]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed, checkout);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) submit();
            }}
          />
          {withCheckout && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={checkout}
                onCheckedChange={(c) => setCheckout(c === true)}
              />
              Check out after create
            </label>
          )}
        </div>
        <DialogFooter>
          <Button disabled={!name.trim()} onClick={submit}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
