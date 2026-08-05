' PDF környezet-próba – 1. lépés
' Azt méri, hogy (a) futhat-e VBS szkript a gépen, és (b) vezérelhető-e a Word.
' Semmit nem telepít és nem módosít: csak egy próba-PDF-et hoz létre ebben a mappában.

Option Explicit

Dim fso, here, docPath, pdfPath, word, doc, msg

Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)

MsgBox "1/3 – A VBS szkript fut." & vbCrLf & vbCrLf & _
       "Mappa: " & here, vbInformation, "PDF próba"

' ── Word elérése ──────────────────────────────────────────────────────────
On Error Resume Next
Set word = CreateObject("Word.Application")
If Err.Number <> 0 Then
  MsgBox "2/3 – A Word NEM vezérelhető." & vbCrLf & vbCrLf & _
         "Hibakód: " & Err.Number & vbCrLf & _
         "Üzenet: " & Err.Description & vbCrLf & vbCrLf & _
         "Eredmény: az 1. próba MEGBUKOTT. Folytasd a 2. próbával.", _
         vbExclamation, "PDF próba"
  WScript.Quit
End If
On Error GoTo 0

msg = "2/3 – A Word vezérelhető." & vbCrLf & vbCrLf & "Word verzió: " & word.Version

' ── Próbadokumentum létrehozása és PDF-be mentése ─────────────────────────
docPath = here & "\proba-forras.docx"
pdfPath = here & "\proba-kimenet.pdf"

On Error Resume Next
word.Visible = False
word.DisplayAlerts = 0

Set doc = word.Documents.Add()
doc.Content.Text = "DocGen PDF környezet-próba." & vbCrLf & _
                   "Ha ezt PDF-ben látod, a Word COM-alapú konverzió működik."
doc.SaveAs2 docPath, 16      ' 16 = wdFormatDocumentDefault (.docx)
doc.SaveAs2 pdfPath, 17      ' 17 = wdFormatPDF
doc.Close False
word.Quit

If Err.Number <> 0 Then
  MsgBox msg & vbCrLf & vbCrLf & _
         "3/3 – A PDF-mentés NEM sikerült." & vbCrLf & _
         "Hibakód: " & Err.Number & vbCrLf & _
         "Üzenet: " & Err.Description, vbExclamation, "PDF próba"
  WScript.Quit
End If
On Error GoTo 0

If fso.FileExists(pdfPath) Then
  MsgBox msg & vbCrLf & vbCrLf & _
         "3/3 – SIKER. Elkészült: proba-kimenet.pdf" & vbCrLf & vbCrLf & _
         "Eredmény: T1 – a legjobb eset. Írd be az EREDMENY.md fájlba.", _
         vbInformation, "PDF próba"
Else
  MsgBox msg & vbCrLf & vbCrLf & _
         "3/3 – A PDF nem jött létre, pedig hibát sem jelzett." & vbCrLf & _
         "Folytasd a 2. próbával.", vbExclamation, "PDF próba"
End If
