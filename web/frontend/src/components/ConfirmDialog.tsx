import React from "react"
import { ModalDialog } from "./ModalDialog"
import { useUiStore } from "../store/ui"

/**
 * 页面内确认框：替换 `window.confirm`。
 *
 * 浏览器自带的确认框只有一个「确定/取消」，这里常有三个出口（保存 / 放弃 / 取消），
 * 比如「换装配时有未保存的修改」。提问放在 ui store 里（`useUiStore.ask`），任何地方
 * 都可以 `await` 用户的选择，所以调用点仍然是一行式的同步写法。
 */
export const ConfirmDialog = () => {
  const confirm = useUiStore((state) => state.confirm)
  const answer = useUiStore((state) => state.answerConfirm)

  if (confirm === null) return null

  return (
    <ModalDialog title={confirm.title} onClose={() => answer("cancel")} width={460}>
      <div className="confirmBody">{confirm.message}</div>
      <div className="confirmActions">
        {confirm.choices.map((choice) => (
          <button
            key={choice.id}
            className={
              (choice.primary ? "primary" : "") + (choice.danger ? " danger" : "") + " confirmButton"
            }
            onClick={() => answer(choice.id)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </ModalDialog>
  )
}
