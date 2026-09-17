import type { ReactElement, ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/coss/ui/alert-dialog.tsx";
import { Button } from "@/components/coss/ui/button.tsx";

export function ConfirmDelete({
  trigger,
  title,
  description,
  onConfirm,
}: {
  trigger: ReactElement;
  title: string;
  description: ReactNode;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={trigger} />
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>取消</AlertDialogClose>
          <AlertDialogClose render={<Button variant="destructive" />} onClick={onConfirm}>
            删除
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
