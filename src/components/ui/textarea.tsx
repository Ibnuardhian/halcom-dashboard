import * as React from "react"
import { cn } from "cn"

/** Enter makes a new line; Ctrl+Enter (Cmd+Enter on a Mac) saves the form the box is in, like Enter does in a one-line field. */
function Textarea({ className, onKeyDown, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      aria-keyshortcuts="Control+Enter"
      title={props.title ?? (props.readOnly ? undefined : "Ctrl+Enter untuk menyimpan")}
      className={cn(
        "min-h-24 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30",
        className
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented || event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return
        const form = event.currentTarget.form
        if (!form) return
        event.preventDefault()
        form.requestSubmit()
      }}
      {...props}
    />
  )
}

export { Textarea }
