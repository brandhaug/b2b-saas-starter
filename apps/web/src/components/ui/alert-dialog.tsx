'use client'

import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        'data-open:motion-safe:animate-in data-closed:motion-safe:animate-out data-closed:fade-out-0 data-open:fade-in-0 bg-overlay/80 duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 z-50',
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  children,
  ...props
}: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        className={cn(
          // Slide/zoom motion is `motion-safe:`-gated; without it the dialog
          // simply appears.
          'bg-background data-open:motion-safe:animate-in data-closed:motion-safe:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:motion-safe:zoom-out-95 data-open:motion-safe:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid grid-cols-1 min-w-0 max-h-dialog-inset w-full max-w-dialog-inset -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-md border border-border p-6 shadow-lg duration-200 sm:max-w-sm wrap-anywhere',
          className
        )}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Popup>
    </AlertDialogPortal>
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        'flex min-w-0 flex-wrap items-center justify-end gap-2 max-md:flex-col max-md:items-stretch [&>button]:break-words [&>button]:h-auto [&>button]:min-w-0 [&>button]:py-2 [&>button]:shrink [&>button]:whitespace-normal max-md:[&>button]:h-auto max-md:[&>button]:min-h-11 max-md:[&>button]:w-full',
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-foreground text-sm font-medium', className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-muted-foreground text-xs/relaxed', className)}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-action"
      render={
        <Button
          className={cn(
            'h-auto min-h-9 min-w-0 shrink whitespace-normal break-words py-2 max-md:h-auto max-md:min-h-11',
            className
          )}
          {...props}
        />
      }
    />
  )
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      render={
        <Button
          variant="outline"
          className={cn(
            'h-auto min-h-9 min-w-0 shrink whitespace-normal break-words py-2 max-md:h-auto max-md:min-h-11',
            className
          )}
          {...props}
        />
      }
    />
  )
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel
}
