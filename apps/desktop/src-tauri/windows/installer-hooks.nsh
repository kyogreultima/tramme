; Tauri includes this file near the top of its installer.nsi, after its own
; includes (FileAssociation.nsh, which supplies UPDATEFILEASSOC) and before its
; defines and pages.

!include LogicLib.nsh

; ── an install made before the publisher was Qualris ──────────
; Tauri keeps the install folder under Software\<publisher>\<product>. Up to
; 0.21.0 there was no publisher and Tauri took the identifier's middle part:
; Software\tramme\Tramme. An installer that reads Software\Qualris\Tramme finds
; nothing there, hands the old uninstaller an empty folder (`_?=`), which fails,
; and the user gets "Unable to uninstall!". Before the first page, the old
; key's folder is copied under the new one, so the reinstall page and the
; uninstaller see the real folder. $(^Name) is the product name (Tramme, or
; Tramme Beta): this file comes before Tauri's PRODUCTNAME is defined.
!define MUI_CUSTOMFUNCTION_GUIINIT TrammeAdoptOlderInstall

Function TrammeAdoptOlderInstall
  ReadRegStr $0 SHCTX "Software\Qualris\$(^Name)" ""
  ${If} $0 == ""
    ReadRegStr $0 SHCTX "Software\tramme\$(^Name)" ""
    ${If} $0 != ""
      WriteRegStr SHCTX "Software\Qualris\$(^Name)" "" $0
      StrCpy $INSTDIR $0
    ${EndIf}
  ${EndIf}
FunctionEnd

; ── the .tramme icon ──────────────────────────────────────────
; Windows caches document icons by their association and executable path.
; Refresh after an install/update so .tramme uses the current transparent
; mark instead of an older icon with a white background.
!macro NSIS_HOOK_POSTINSTALL
  !insertmacro UPDATEFILEASSOC
  ; the old key has served (TrammeAdoptOlderInstall): the folder is under Qualris now
  DeleteRegKey SHCTX "Software\tramme\${PRODUCTNAME}"
  DeleteRegKey /ifempty SHCTX "Software\tramme"
!macroend

; Also refresh after removing the associations on uninstall.
!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro UPDATEFILEASSOC
!macroend
