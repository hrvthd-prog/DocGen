Attribute VB_Name = "PdfProba"
' PDF kornyezet-proba - 2. lepes (Word makro)
'
' FIGYELEM - EKEZETEK: ebben a fajlban szandekosan NINCS ekezetes betu.
' A VBA kodablak ANSI-alapu, es az "o" meg az "u" (hosszu, kettos ekezettel)
' nincs benne a nyugati kodlapban (CP1252). Ha ekezetes szoveget masolunk be,
' azok a betuk elromlanak - ezert marad minden ASCII. A magyar leiras az
' OLVASD-EL.md fajlban van, azt barmelyik szerkeszto helyesen mutatja.
'
' HASZNALAT:
'  1. Nyiss meg egy ures Word-dokumentumot.
'  2. Nyomd meg az Alt + F11 billentyuket (VBA-szerkeszto).
'     - Ha nem nyilik meg semmi, a makrok hazirenddel tiltottak -> 3. proba.
'  3. A bal oldali faban jelold ki a "Normal" bejegyzest,
'     majd Insert (Beszuras) -> Module.
'  4. Masold be ide ezt az egesz szoveget.
'  5. Nyomd meg az F5 billentyut (futtatas).
'
' A makro egy proba-PDF-et hoz letre az Asztalon. Semmit nem telepit.

Option Explicit

Public Sub PdfProbaFuttatas()
    Dim celMappa As String
    Dim pdfUt As String
    Dim doc As Document
    Dim uzenet As String

    celMappa = Environ$("USERPROFILE") & "\Desktop"
    pdfUt = celMappa & "\proba-makro.pdf"

    uzenet = "Word verzio: " & Application.Version

    On Error GoTo Hiba

    Set doc = Documents.Add
    doc.Content.Text = "DocGen PDF kornyezet-proba (makro)." & vbCrLf & _
                       "Ha ezt PDF-ben latod, a makro-alapu konverzio mukodik."
    doc.ExportAsFixedFormat OutputFileName:=pdfUt, ExportFormat:=wdExportFormatPDF
    doc.Close SaveChanges:=False

    If Len(Dir$(pdfUt)) > 0 Then
        MsgBox uzenet & vbCrLf & vbCrLf & _
               "SIKER. Elkeszult az Asztalon: proba-makro.pdf" & vbCrLf & vbCrLf & _
               "Eredmeny: T1b - a makros ut jarhato. Ird be az EREDMENY.md fajlba.", _
               vbInformation, "PDF proba"
    Else
        MsgBox uzenet & vbCrLf & vbCrLf & _
               "A PDF nem jott letre, pedig hibat sem jelzett." & vbCrLf & _
               "Folytasd a 3. probaval.", vbExclamation, "PDF proba"
    End If
    Exit Sub

Hiba:
    MsgBox uzenet & vbCrLf & vbCrLf & _
           "A PDF-mentes NEM sikerult." & vbCrLf & _
           "Hibakod: " & Err.Number & vbCrLf & _
           "Uzenet: " & Err.Description & vbCrLf & vbCrLf & _
           "Eredmeny: a 2. proba MEGBUKOTT. Folytasd a 3. probaval.", _
           vbExclamation, "PDF proba"
    On Error Resume Next
    If Not doc Is Nothing Then doc.Close SaveChanges:=False
End Sub
