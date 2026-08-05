Attribute VB_Name = "PdfProba"
' PDF környezet-próba – 2. lépés (Word makró)
'
' HASZNÁLAT:
'  1. Nyiss meg egy üres Word-dokumentumot.
'  2. Nyomd meg az Alt + F11 billentyűket (VBA-szerkesztő).
'     – Ha nem nyílik meg semmi, a makrók házirenddel tiltottak → 3. próba.
'  3. A bal oldali fában jelöld ki a "Normal" bejegyzést,
'     majd Insert (Beszúrás) → Module.
'  4. Másold be ide ezt az egész szöveget.
'  5. Nyomd meg az F5 billentyűt (futtatás).
'
' A makró egy próba-PDF-et hoz létre az Asztalon. Semmit nem telepít.

Option Explicit

Public Sub PdfProbaFuttatas()
    Dim celMappa As String
    Dim pdfUt As String
    Dim doc As Document
    Dim uzenet As String

    celMappa = Environ$("USERPROFILE") & "\Desktop"
    pdfUt = celMappa & "\proba-makro.pdf"

    uzenet = "Word verzió: " & Application.Version

    On Error GoTo Hiba

    Set doc = Documents.Add
    doc.Content.Text = "DocGen PDF környezet-próba (makró)." & vbCrLf & _
                       "Ha ezt PDF-ben látod, a makró-alapú konverzió működik."
    doc.ExportAsFixedFormat OutputFileName:=pdfUt, ExportFormat:=wdExportFormatPDF
    doc.Close SaveChanges:=False

    If Len(Dir$(pdfUt)) > 0 Then
        MsgBox uzenet & vbCrLf & vbCrLf & _
               "SIKER. Elkészült az Asztalon: proba-makro.pdf" & vbCrLf & vbCrLf & _
               "Eredmény: T1b – a makrós út járható. Írd be az EREDMENY.md fájlba.", _
               vbInformation, "PDF próba"
    Else
        MsgBox uzenet & vbCrLf & vbCrLf & _
               "A PDF nem jött létre, pedig hibát sem jelzett." & vbCrLf & _
               "Folytasd a 3. próbával.", vbExclamation, "PDF próba"
    End If
    Exit Sub

Hiba:
    MsgBox uzenet & vbCrLf & vbCrLf & _
           "A PDF-mentés NEM sikerült." & vbCrLf & _
           "Hibakód: " & Err.Number & vbCrLf & _
           "Üzenet: " & Err.Description & vbCrLf & vbCrLf & _
           "Eredmény: a 2. próba MEGBUKOTT. Folytasd a 3. próbával.", _
           vbExclamation, "PDF próba"
    On Error Resume Next
    If Not doc Is Nothing Then doc.Close SaveChanges:=False
End Sub
