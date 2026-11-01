; Windows caches document icons by their association and executable path.
; Refresh after an install/update so .tramme uses the current transparent
; mark instead of an older icon with a white background. Tauri includes
; FileAssociation.nsh before this file, which supplies UPDATEFILEASSOC.
!macro NSIS_HOOK_POSTINSTALL
  !insertmacro UPDATEFILEASSOC
!macroend

; Also refresh after removing the associations on uninstall.
!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro UPDATEFILEASSOC
!macroend
