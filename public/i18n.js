// Interface language (de / en / es / it). The app is written in German; this layer translates the rendered
// interface: text nodes and placeholder / aria-label / title attributes, live as pages change.
// Entries: "Deutsch|English|Español|Italiano". Data people type (names, notes, exercises) is left alone.
(function () {
  'use strict';

  const LANGS = ['de', 'en', 'es', 'it'];
  const LOCALES = { de: 'de-DE', en: 'en-GB', es: 'es-ES', it: 'it-IT' };

  const RAW = `
Tracker|Tracker|Tracker|Tracker
Training|Training|Entreno|Allenamento
Ernährung|Nutrition|Nutrición|Alimentazione
Nachrichten|Messages|Mensajes|Messaggi
Einstellungen|Settings|Ajustes|Impostazioni
Klienten|Clients|Clientes|Clienti
Check-in|Check-in|Check-in|Check-in
Admin|Admin|Admin|Admin
Konto|Account|Cuenta|Account
Abmelden|Log out|Cerrar sesión|Esci
Profil|Profile|Perfil|Profilo
Hall of Fame|Hall of Fame|Salón de la fama|Hall of Fame
Medaillen|Medals|Medallas|Medaglie
Kühlschrank|Fridge|Nevera|Frigo
Shop|Shop|Tienda|Negozio
Konto-Menü|Account menu|Menú de cuenta|Menu account
Hauptnavigation|Main navigation|Navegación principal|Navigazione principale
Lädt|Loading|Cargando|Caricamento
Lade…|Loading…|Cargando…|Caricamento…
StayOnTrack lädt|StayOnTrack is loading|StayOnTrack se está cargando|StayOnTrack si sta caricando
Anmelden|Log in|Iniciar sesión|Accedi
Benutzername|Username|Usuario|Nome utente
Passwort|Password|Contraseña|Password
Gewicht, Schritte, Schlaf und Ernährung an einem Ort. Dein Coach sieht mit – du bleibst dran.|Weight, steps, sleep and nutrition in one place. Your coach follows along – you stay on track.|Peso, pasos, sueño y nutrición en un solo lugar. Tu coach lo ve contigo – tú sigues en marcha.|Peso, passi, sonno e alimentazione in un unico posto. Il tuo coach segue con te – tu resti in carreggiata.
StayOnTrack · Coaching|StayOnTrack · Coaching|StayOnTrack · Coaching|StayOnTrack · Coaching
Guten Morgen|Good morning|Buenos días|Buongiorno
Guten Mittag|Good afternoon|Buenas tardes|Buon pomeriggio
Schönen Nachmittag|Good afternoon|Buenas tardes|Buon pomeriggio
Guten Abend|Good evening|Buenas noches|Buonasera
Gute Nacht|Good night|Buenas noches|Buonanotte
Heute|Today|Hoy|Oggi
Tag eintragen|Log today|Registrar el día|Registra la giornata
Eintrag ergänzen|Complete entry|Completar registro|Completa la registrazione
offen|open|pendiente|aperto
Gewicht|Weight|Peso|Peso
Schritte|Steps|Pasos|Passi
Schlaf|Sleep|Sueño|Sonno
Kalorien|Calories|Calorías|Calorie
eingehalten|on plan|cumplidas|rispettate
nicht eingehalten|not on plan|no cumplidas|non rispettate
Ja|Yes|Sí|Sì
Nein|No|No|No
Verlauf|History|Historial|Andamento
Alle Einträge|All entries|Todos los registros|Tutte le registrazioni
Anzeigen|Show|Mostrar|Mostra
Ausblenden|Hide|Ocultar|Nascondi
Tageseintrag|Daily entry|Registro diario|Registrazione giornaliera
noch offen|still open|pendiente|ancora aperto
gespeichert|saved|guardado|salvato
Schließen|Close|Cerrar|Chiudi
Datum|Date|Fecha|Data
Schlaf (letzte Nacht)|Sleep (last night)|Sueño (anoche)|Sonno (stanotte)
Std.|h|h|h
Min.|min|min|min
Trainingstag?|Training day?|¿Día de entreno?|Giorno di allenamento?
Kalorien laut Plan eingehalten?|Calories on plan?|¿Calorías según el plan?|Calorie secondo il piano?
Wie viel hast du gegessen?|How much did you eat?|¿Cuánto has comido?|Quanto hai mangiato?
Notiz|Note|Nota|Nota
(optional)|(optional)|(opcional)|(facoltativo)
Wie lief der Tag? Training, Ernährung, Befinden…|How was your day? Training, food, how you feel…|¿Qué tal el día? Entreno, comida, cómo te sientes…|Com'è andata la giornata? Allenamento, cibo, come stai…
Speichern|Save|Guardar|Salva
Gespeichert|Saved|Guardado|Salvato
Du kannst jeden Wert auch später am Tag ergänzen – bereits gespeicherte Werte bleiben erhalten.|You can add any value later in the day – values you saved stay.|Puedes completar cualquier valor más tarde – lo guardado se mantiene.|Puoi aggiungere ogni valore più tardi – quelli salvati restano.
z. B. 82,4|e.g. 82.4|p. ej. 82,4|es. 82,4
z. B. 8500|e.g. 8500|p. ej. 8500|es. 8500
z. B. 2650|e.g. 2650|p. ej. 2650|es. 2650
Tage in Folge eingetragen|days logged in a row|días seguidos registrados|giorni di fila registrati
Gewicht – 14 Tage|Weight – 14 days|Peso – 14 días|Peso – 14 giorni
Schritte pro Tag|Steps per day|Pasos por día|Passi al giorno
Schlaf pro Nacht|Sleep per night|Sueño por noche|Sonno per notte
Tageswert|Daily value|Valor diario|Valore giornaliero
Ø 7 Tage|7-day avg|Media 7 días|Media 7 giorni
Mittelwert|Average|Media|Media
Range|Range|Rango|Intervallo
Ziel erreicht|Goal reached|Objetivo alcanzado|Obiettivo raggiunto
Training|Training|Entreno|Allenamento
× in 7 Tagen|× in 7 days|× en 7 días|× in 7 giorni
Keine Einträge in diesem Zeitraum.|No entries in this period.|No hay registros en este periodo.|Nessuna registrazione in questo periodo.
Bearbeiten|Edit|Editar|Modifica
Löschen|Delete|Eliminar|Elimina
Eintrag gelöscht|Entry deleted|Registro eliminado|Registrazione eliminata
Zeitraum der Diagramme|Chart period|Periodo de los gráficos|Periodo dei grafici
Alle|All|Todo|Tutto
Noch kein Wert|No value yet|Aún sin valor|Ancora nessun valore
Vorgabe|Target|Objetivo|Obiettivo
Keine Vorgabe|No target|Sin objetivo|Nessun obiettivo
📋 Check-in von deinem Coach|📋 Check-in from your coach|📋 Check-in de tu coach|📋 Check-in dal tuo coach
Vorgeschlagene Anpassungen für deinen Plan|Suggested changes to your plan|Cambios propuestos para tu plan|Modifiche proposte al tuo piano
✓ Anpassungen annehmen|✓ Accept changes|✓ Aceptar cambios|✓ Accetta modifiche
Antworten|Reply|Responder|Rispondi
Deine Antwort an den Coach…|Your reply to your coach…|Tu respuesta al coach…|La tua risposta al coach…
Antwort senden|Send reply|Enviar respuesta|Invia risposta
Anpassungen angenommen – dein Plan ist aktualisiert ✓|Changes accepted – your plan is updated ✓|Cambios aceptados – tu plan está actualizado ✓|Modifiche accettate – il tuo piano è aggiornato ✓
Highlights deiner Woche|Highlights of your week|Lo mejor de tu semana|I momenti migliori della settimana
🔔 Erinnerungen & Nachrichten von deinem Coach aufs Handy?|🔔 Reminders & messages from your coach on your phone?|🔔 ¿Recordatorios y mensajes de tu coach en el móvil?|🔔 Promemoria e messaggi del coach sul telefono?
Ja, aktivieren|Yes, turn on|Sí, activar|Sì, attiva
Später|Later|Más tarde|Più tardi
Nein danke|No thanks|No, gracias|No grazie
Push-Benachrichtigungen|Push notifications|Notificaciones push|Notifiche push
Erinnerungen deines Coaches und neue Chat-Nachrichten direkt aufs Handy.|Your coach's reminders and new chat messages straight to your phone.|Recordatorios de tu coach y nuevos mensajes directamente en tu móvil.|Promemoria del coach e nuovi messaggi direttamente sul telefono.
Benachrichtigungen aktivieren|Turn on notifications|Activar notificaciones|Attiva notifiche
Benachrichtigungen aktiviert ✓|Notifications on ✓|Notificaciones activadas ✓|Notifiche attivate ✓
Deaktivieren|Turn off|Desactivar|Disattiva
Test senden|Send test|Enviar prueba|Invia prova
Aktiv auf diesem Gerät|Active on this device|Activo en este dispositivo|Attivo su questo dispositivo
Von diesem Browser nicht unterstützt|Not supported by this browser|No compatible con este navegador|Non supportato da questo browser
Erst zum Home-Bildschirm hinzufügen|Add to home screen first|Primero añádelo a la pantalla de inicio|Prima aggiungi alla schermata Home
Darstellung|Appearance|Apariencia|Aspetto
Gilt für dein Konto auf allen Geräten.|Applies to your account on all devices.|Se aplica a tu cuenta en todos los dispositivos.|Vale per il tuo account su tutti i dispositivi.
Sprache|Language|Idioma|Lingua
Erscheinungsbild|Theme|Tema|Tema
System|System|Sistema|Sistema
Hell|Light|Claro|Chiaro
Dunkel|Dark|Oscuro|Scuro
Liquid Glass|Liquid Glass|Liquid Glass|Liquid Glass
Gläserne, durchscheinende Leisten und Menüs – angelehnt an das aktuelle iOS-Design.|Glassy, translucent bars and menus – inspired by the latest iOS design.|Barras y menús de cristal translúcido – inspirado en el diseño actual de iOS.|Barre e menu in vetro traslucido – ispirati all'attuale design di iOS.
An|On|Sí|On
Aus|Off|No|Off
Dein Profil|Your profile|Tu perfil|Il tuo profilo
Coach|Coach|Coach|Coach
Profilbild|Profile picture|Foto de perfil|Foto profilo
Bild wählen|Choose picture|Elegir imagen|Scegli immagine
Entfernen|Remove|Quitar|Rimuovi
Sieht nur dein Coach.|Only your coach sees it.|Solo la ve tu coach.|La vede solo il tuo coach.
Name|Name|Nombre|Nome
Damit meldest du dich an. 3–32 Zeichen: Buchstaben, Ziffern, . _ -|You log in with this. 3–32 characters: letters, digits, . _ -|Con esto inicias sesión. 3–32 caracteres: letras, números, . _ -|Serve per accedere. 3–32 caratteri: lettere, cifre, . _ -
Ändere dein Passwort regelmäßig und nutze es nirgendwo sonst.|Change your password regularly and don't use it anywhere else.|Cambia tu contraseña con regularidad y no la uses en otro sitio.|Cambia la password regolarmente e non usarla altrove.
Passwort ändern|Change password|Cambiar contraseña|Cambia password
Aktuelles Passwort|Current password|Contraseña actual|Password attuale
Neues Passwort|New password|Nueva contraseña|Nuova password
Mindestens 8 Zeichen|At least 8 characters|Mínimo 8 caracteres|Almeno 8 caratteri
Passwort geändert|Password changed|Contraseña cambiada|Password cambiata
Profilbild gespeichert|Profile picture saved|Foto de perfil guardada|Foto profilo salvata
Profilbild entfernt|Profile picture removed|Foto de perfil eliminada|Foto profilo rimossa
Abbrechen|Cancel|Cancelar|Annulla
Nachricht schreiben…|Write a message…|Escribe un mensaje…|Scrivi un messaggio…
Senden|Send|Enviar|Invia
Noch keine Nachrichten|No messages yet|Aún no hay mensajes|Ancora nessun messaggio
Du:|You:|Tú:|Tu:
Ernährungsplan|Nutrition plan|Plan de nutrición|Piano alimentare
Von deinem Coach|From your coach|De tu coach|Dal tuo coach
Du kannst einzelne Lebensmittel oder ganze Mahlzeiten zum Tausch anfragen – dein Coach entscheidet.|You can request swaps for single foods or whole meals – your coach decides.|Puedes pedir cambiar alimentos o comidas enteras – tu coach decide.|Puoi chiedere di sostituire singoli alimenti o pasti interi – decide il coach.
⇄ Tauschen|⇄ Swap|⇄ Cambiar|⇄ Sostituisci
Tausch angefragt|Swap requested|Cambio solicitado|Sostituzione richiesta
Ganze Mahlzeit tauschen anfragen|Request swapping the whole meal|Pedir cambiar la comida entera|Chiedi di sostituire l'intero pasto
Tausch der ganzen Mahlzeit angefragt|Whole-meal swap requested|Cambio de la comida entera solicitado|Sostituzione dell'intero pasto richiesta
Meine Tauschwünsche|My swap requests|Mis solicitudes de cambio|Le mie richieste
Dein Coach erstellt gerade deinen Ernährungsplan.|Your coach is creating your nutrition plan.|Tu coach está creando tu plan de nutrición.|Il tuo coach sta creando il tuo piano alimentare.
Wogegen möchtest du tauschen?|What would you like instead?|¿Por qué quieres cambiarlo?|Con cosa vuoi sostituirlo?
Was möchtest du stattdessen essen?|What would you rather eat?|¿Qué prefieres comer en su lugar?|Cosa preferiresti mangiare?
Anfrage senden|Send request|Enviar solicitud|Invia richiesta
Zurückziehen|Withdraw|Retirar|Ritira
✓ Angenommen|✓ Accepted|✓ Aceptado|✓ Accettato
✗ Abgelehnt|✗ Declined|✗ Rechazado|✗ Rifiutato
Lebensmittel suchen|Search foods|Buscar alimentos|Cerca alimenti
Keine Treffer.|No results.|Sin resultados.|Nessun risultato.
Dein Trainingsplan|Your training plan|Tu plan de entreno|Il tuo piano di allenamento
Trainingsplan|Training plan|Plan de entreno|Piano di allenamento
Neu|New|Nuevo|Nuovo
Noch kein Plan. In zwei Schritten zu deinem Standardplan – danach kannst du alles anpassen.|No plan yet. Two steps to your standard plan – then you can adjust everything.|Aún no hay plan. Dos pasos hasta tu plan estándar – luego puedes ajustarlo todo.|Ancora nessun piano. Due passi per il tuo piano standard – poi puoi modificare tutto.
Wie oft pro Woche trainieren?|How often per week?|¿Cuántas veces por semana?|Quante volte a settimana?
Welcher Split?|Which split?|¿Qué split?|Quale split?
Tage|days|días|giorni
Passt|Fits|Encaja|Adatto
Frei|Free|Libre|Libero
Eigener Split|Custom split|Split propio|Split personalizzato
Ganzkörper|Full body|Cuerpo completo|Total body
Arnold-Split|Arnold split|Split Arnold|Split Arnold
Bro-Split|Bro split|Bro split|Bro split
Jede Muskelgruppe in jedem Training – ideal für Einsteiger und wenig Zeit.|Every muscle group every session – ideal for beginners and busy weeks.|Todos los grupos musculares en cada sesión – ideal para principiantes y poco tiempo.|Ogni gruppo muscolare in ogni seduta – ideale per principianti e poco tempo.
Oberkörper und Unterkörper im Wechsel, jede Muskelgruppe 2× pro Woche.|Upper and lower body alternate, each muscle group 2× per week.|Tren superior e inferior alternos, cada grupo 2× por semana.|Parte alta e bassa alternate, ogni gruppo 2× a settimana.
Drücken, Ziehen, Beine. Mit 6 Tagen jede Muskelgruppe 2× pro Woche.|Push, pull, legs. With 6 days every muscle group 2× per week.|Empuje, tirón, piernas. Con 6 días cada grupo 2× por semana.|Spinta, trazione, gambe. Con 6 giorni ogni gruppo 2× a settimana.
Rumpf (Brust, Rücken, Bauch) und Extremitäten (Beine, Arme, Seitliche Schulter).|Torso (chest, back, abs) and limbs (legs, arms, side delts).|Torso (pecho, espalda, abdomen) y extremidades (piernas, brazos, deltoides laterales).|Busto (petto, schiena, addome) e arti (gambe, braccia, deltoidi laterali).
Hybrid für 5 Tage: Upper, Lower, dann Push, Pull, Legs.|5-day hybrid: upper, lower, then push, pull, legs.|Híbrido de 5 días: superior, inferior, luego empuje, tirón, piernas.|Ibrido da 5 giorni: alta, bassa, poi spinta, trazione, gambe.
Brust & Rücken, Schultern & Arme, Beine – klassisch mit 6 Tagen.|Chest & back, shoulders & arms, legs – classically 6 days.|Pecho y espalda, hombros y brazos, piernas – clásico con 6 días.|Petto e schiena, spalle e braccia, gambe – classico con 6 giorni.
Ein Muskel pro Tag: Brust, Rücken, Schultern, Beine, Arme.|One muscle per day: chest, back, shoulders, legs, arms.|Un músculo por día: pecho, espalda, hombros, piernas, brazos.|Un muscolo al giorno: petto, schiena, spalle, gambe, braccia.
Tage selbst benennen und Übungen frei zusammenstellen.|Name your days and pick exercises freely.|Nombra tus días y elige los ejercicios libremente.|Dai un nome ai giorni e scegli liberamente gli esercizi.
Plan bearbeiten|Edit plan|Editar plan|Modifica piano
Benenne die Tage, passe Übungen an und füge mit + neue hinzu. Gespeichert wird unten.|Name the days, adjust exercises and add new ones with +. Save at the bottom.|Nombra los días, ajusta ejercicios y añade nuevos con +. Se guarda abajo.|Dai un nome ai giorni, modifica gli esercizi e aggiungine con +. Si salva in basso.
Split wechseln|Change split|Cambiar split|Cambia split
Übung|Exercise|Ejercicio|Esercizio
Sätze|Sets|Series|Serie
Wdh.|Reps|Reps|Rip.
Übung hinzufügen|Add exercise|Añadir ejercicio|Aggiungi esercizio
+ Trainingstag hinzufügen|+ Add training day|+ Añadir día de entreno|+ Aggiungi giorno
Plan speichern|Save plan|Guardar plan|Salva piano
Noch keine Übungen.|No exercises yet.|Aún no hay ejercicios.|Ancora nessun esercizio.
Training starten|Start workout|Empezar entreno|Inizia allenamento
Noch kein Training gespeichert.|No workout saved yet.|Aún no hay entrenos guardados.|Nessun allenamento salvato.
Letztes Training:|Last workout:|Último entreno:|Ultimo allenamento:
Trainingshistorie|Training history|Historial de entreno|Storico allenamenti
← Trainingsplan|← Training plan|← Plan de entreno|← Piano di allenamento
Satz|Set|Serie|Serie
Gewicht|Weight|Peso|Peso
Training speichern|Save workout|Guardar entreno|Salva allenamento
Training gespeichert|Workout saved|Entreno guardado|Allenamento salvato
Erstes Mal – trag dein Startgewicht ein.|First time – enter your starting weight.|Primera vez – introduce tu peso inicial.|Prima volta – inserisci il peso iniziale.
Die Werte vom letzten Mal sind schon eingetragen – passe an, was du heute geschafft hast.|Last time's values are already filled in – adjust to what you did today.|Los valores de la última vez ya están – ajusta lo que hiciste hoy.|I valori dell'ultima volta sono già inseriti – adatta a ciò che hai fatto oggi.
Trag pro Satz Gewicht und Wiederholungen ein. Beim nächsten Mal stehen diese Werte schon hier.|Enter weight and reps per set. Next time these values will already be here.|Introduce peso y repeticiones por serie. La próxima vez ya estarán aquí.|Inserisci peso e ripetizioni per serie. La prossima volta saranno già qui.
Schwerster Satz pro Training – so siehst du, wie sich deine Gewichte entwickeln.|Heaviest set per workout – see how your weights develop.|Serie más pesada por entreno – así ves cómo evolucionan tus pesos.|Serie più pesante per allenamento – così vedi come crescono i carichi.
Bestwert|Best|Mejor marca|Record
zuletzt|last|último|ultimo
Noch keine Trainings gespeichert. Starte im Trainingsplan ein Training – danach siehst du hier für jede Übung deinen Verlauf.|No workouts saved yet. Start one in your training plan – then you'll see each exercise's progress here.|Aún no hay entrenos. Empieza uno en tu plan – luego verás aquí la evolución de cada ejercicio.|Ancora nessun allenamento. Avviane uno dal piano – poi qui vedrai l'andamento di ogni esercizio.
Deine Erfolge|Your achievements|Tus logros|I tuoi traguardi
Erfolge|Achievements|Logros|Traguardi
Jede Medaille steht für etwas, das du durchgezogen hast. Ausgegraute zeigen, was als Nächstes kommt.|Every medal stands for something you pulled through. Greyed-out ones show what's next.|Cada medalla representa algo que lograste. Las grises muestran lo que viene.|Ogni medaglia è qualcosa che hai portato a termine. Quelle grigie mostrano cosa viene dopo.
von 30 Medaillen|of 30 medals|de 30 medallas|di 30 medaglie
Fast geschafft|Almost there|Casi lo tienes|Quasi fatto
Bronze|Bronze|Bronce|Bronzo
Silber|Silver|Plata|Argento
Gold|Gold|Oro|Oro
Alle Stufen 🎉|All tiers 🎉|Todos los niveles 🎉|Tutti i livelli 🎉
Neu freigeschaltet:|Newly unlocked:|Recién desbloqueado:|Appena sbloccato:
Dranbleiber|Stay-on-tracker|Constante|Costante
Kilometerfresser|Mile muncher|Devorakilómetros|Macinachilometri
Zielläufer|Goal walker|Caminante con meta|Camminatore da obiettivo
Schlafprofi|Sleep pro|Experto en sueño|Professionista del sonno
Waagen-Routine|Scale routine|Rutina de báscula|Routine della bilancia
Plantreue|Plan keeper|Fiel al plan|Fedele al piano
Eisenfreund|Iron friend|Amigo del hierro|Amico del ferro
Tonnenstemmer|Tonnage lifter|Levantatoneladas|Sollevatore di tonnellate
Rekordjäger|Record hunter|Cazarrécords|Cacciatore di record
Teamplayer|Team player|Jugador de equipo|Gioco di squadra
Was sich dein Klient mit seinen Medaillen gegönnt hat.|What your client treated themselves to with medals.|Lo que tu cliente se ha dado con sus medallas.|Cosa si è concesso il tuo cliente con le medaglie.
Dein Kühlschrank – gefüllt mit dem, was du dir mit Medaillen verdient hast.|Your fridge – filled with what you earned with medals.|Tu nevera – llena de lo que te has ganado con medallas.|Il tuo frigo – pieno di ciò che hai guadagnato con le medaglie.
Inhalt des Kühlschranks|Fridge contents|Contenido de la nevera|Contenuto del frigo
↻ Nochmal reingleiten|↻ Glide in again|↻ Entrar otra vez|↻ Entra di nuovo
Noch leer. Im|Still empty. In the|Aún vacía. En la|Ancora vuoto. Nel
tauschst du Medaillen gegen Dosen.|you trade medals for cans.|cambias medallas por latas.|scambi medaglie con lattine.
Noch leer – dein Klient hat sich noch nichts gegönnt.|Still empty – your client hasn't treated themselves yet.|Aún vacía – tu cliente todavía no se ha dado ningún capricho.|Ancora vuoto – il tuo cliente non si è ancora concesso nulla.
Tausche deine Medaillen gegen eine kalte Dose für deinen Kühlschrank.|Trade your medals for a cold can for your fridge.|Cambia tus medallas por una lata fría para tu nevera.|Scambia le medaglie con una lattina fresca per il tuo frigo.
Medaille verfügbar|medal available|medalla disponible|medaglia disponibile
Medaillen verfügbar|medals available|medallas disponibles|medaglie disponibili
Zum Kühlschrank →|To the fridge →|A la nevera →|Al frigo →
Kaufen|Buy|Comprar|Compra
Ab in den Kühlschrank|Into the fridge|A la nevera|Nel frigo
Das ist neu: StayOnTrack|What's new: StayOnTrack|Novedades: StayOnTrack|Novità: StayOnTrack
Verstanden|Got it|Entendido|Ho capito
Zum Trainingsplan|To the training plan|Al plan de entreno|Al piano di allenamento
Zum Shop|To the shop|A la tienda|Al negozio
Neuer Name: StayOnTrack|New name: StayOnTrack|Nuevo nombre: StayOnTrack|Nuovo nome: StayOnTrack
Mit neuem, schlichtem Logo.|With a new, minimal logo.|Con un logo nuevo y minimalista.|Con un nuovo logo minimalista.
Sprache & Erscheinungsbild|Language & theme|Idioma y tema|Lingua e tema
In den Einstellungen: Deutsch, Englisch, Spanisch oder Italienisch – und Hell, Dunkel oder wie das System.|In Settings: German, English, Spanish or Italian – and light, dark or like your system.|En Ajustes: alemán, inglés, español o italiano – y claro, oscuro o como el sistema.|Nelle impostazioni: tedesco, inglese, spagnolo o italiano – e chiaro, scuro o come il sistema.
Optional in den Einstellungen: gläserne Leisten und Menüs wie im aktuellen iOS.|Optional in Settings: glass bars and menus like the latest iOS.|Opcional en Ajustes: barras y menús de cristal como en el iOS actual.|Facoltativo nelle impostazioni: barre e menu in vetro come nell'iOS attuale.
Kühlschrank & Shop|Fridge & shop|Nevera y tienda|Frigo e negozio
Hall of Fame jetzt unter Konto. Tausche Medaillen im Shop gegen Dosen für deinen Kühlschrank.|Hall of Fame now lives under Account. Trade medals in the shop for cans for your fridge.|El Salón de la fama está ahora en Cuenta. Cambia medallas en la tienda por latas para tu nevera.|La Hall of Fame ora è in Account. Scambia medaglie nel negozio con lattine per il tuo frigo.
Unter Konto: Deutsch, Englisch, Spanisch oder Italienisch – und Hell, Dunkel oder wie das System.|Under Account: German, English, Spanish or Italian – and light, dark or like your system.|En Cuenta: alemán, inglés, español o italiano – y claro, oscuro o como el sistema.|In Account: tedesco, inglese, spagnolo o italiano – e chiaro, scuro o come il sistema.
Optional unter Konto: gläserne Leisten und Menüs wie im aktuellen iOS.|Optional under Account: glass bars and menus like the latest iOS.|Opcional en Cuenta: barras y menús de cristal como en el iOS actual.|Facoltativo in Account: barre e menu in vetro come nell'iOS attuale.
In der Hall of Fame deiner Klienten siehst du, was sie sich mit Medaillen gegönnt haben.|In your clients' Hall of Fame you see what they treated themselves to with medals.|En el Salón de la fama de tus clientes ves lo que se han dado con medallas.|Nella Hall of Fame dei tuoi clienti vedi cosa si sono concessi con le medaglie.
Apple Health|Apple Health|Apple Health|Apple Health
Apple Health ist vorerst deaktiviert.|Apple Health is switched off for now.|Apple Health está desactivado por ahora.|Apple Health è disattivato per ora.
Übersicht|Overview|Resumen|Panoramica
Meine Klienten|My clients|Mis clientes|I miei clienti
Zu erledigen|To do|Pendiente|Da fare
Alle Klienten|All clients|Todos los clientes|Tutti i clienti
← Alle Klienten|← All clients|← Todos los clientes|← Tutti i clienti
Alles erledigt.|All done.|Todo hecho.|Tutto fatto.
Gerade wartet nichts auf dich.|Nothing is waiting for you right now.|Ahora mismo no hay nada pendiente.|Al momento non c'è nulla in attesa.
Check-ins ab Samstag|Check-ins from Saturday|Check-ins desde el sábado|Check-in da sabato
Klient|Client|Cliente|Cliente
CSV exportieren|Export CSV|Exportar CSV|Esporta CSV
+ Neuer Klient|+ New client|+ Nuevo cliente|+ Nuovo cliente
Ungelesene Nachrichten|Unread messages|Mensajes sin leer|Messaggi non letti
Gewicht heute offen|Weight still open today|Peso pendiente hoy|Peso ancora da inserire oggi
Plananpassungen offen|Plan changes open|Cambios de plan pendientes|Modifiche al piano aperte
Ohne Eintrag seit 2+ Tagen|No entry for 2+ days|Sin registro desde hace 2+ días|Nessuna registrazione da 2+ giorni
Tauschwünsche|Swap requests|Solicitudes de cambio|Richieste di sostituzione
Push-Benachrichtigungen|Push notifications|Notificaciones push|Notifiche push
Ziele ändern|Change goals|Cambiar objetivos|Modifica obiettivi
Kategorie|Category|Categoría|Categoria
Plan & Ziele|Plan & goals|Plan y objetivos|Piano e obiettivi
Zielgewicht|Target weight|Peso objetivo|Peso obiettivo
Zielkalorien pro Tag|Daily calorie target|Calorías objetivo por día|Calorie obiettivo al giorno
nur für dich sichtbar|only visible to you|solo visible para ti|visibile solo a te
Alle Chats|All chats|Todos los chats|Tutte le chat
Chats|Chats|Chats|Chat
Zuletzt|Last|Último|Ultimo
zuletzt geändert von dir|last changed by you|último cambio tuyo|ultima modifica tua
zuletzt geändert von deinem Coach|last changed by your coach|último cambio de tu coach|ultima modifica del tuo coach
Tage eingetragen|days logged|días registrados|giorni registrati
30 T|30 d|30 d|30 g
90 T|90 d|90 d|90 g
1 J|1 y|1 a|1 a
Medaille|medal|medalla|medaglia
Auf dem iPhone funktionieren Push-Nachrichten nur, wenn StayOnTrack auf dem Home-Bildschirm liegt: In Safari unten auf das Teilen-Symbol tippen → „Zum Home-Bildschirm“ → danach StayOnTrack über das neue App-Symbol öffnen und hier aktivieren.|On iPhone, push notifications only work when StayOnTrack is on your home screen: in Safari tap the Share icon → “Add to Home Screen” → then open StayOnTrack from the new app icon and turn them on here.|En iPhone, las notificaciones solo funcionan si StayOnTrack está en la pantalla de inicio: en Safari toca Compartir → “Añadir a pantalla de inicio” → abre StayOnTrack desde el nuevo icono y actívalas aquí.|Su iPhone le notifiche funzionano solo se StayOnTrack è nella schermata Home: in Safari tocca Condividi → “Aggiungi alla schermata Home” → poi apri StayOnTrack dalla nuova icona e attivale qui.
Gewöhnlich|Common|Común|Comune
Selten|Rare|Rara|Rara
Episch|Epic|Épica|Epica
Legendär|Legendary|Legendaria|Leggendaria
Zielmuskeln|Target muscles|Músculos trabajados|Muscoli target
Tipp:|Tip:|Consejo:|Consiglio:
Start|Start|Inicio|Inizio
Ende|End|Final|Fine
Anleitung|How to|Cómo se hace|Come si fa
heute|today|hoy|oggi
gestern|yesterday|ayer|ieri
noch nie|never|nunca|mai
`;

  const DICT = new Map();
  for (const line of RAW.split('\n')) {
    const parts = line.split('|');
    if (parts.length !== 4) continue;
    DICT.set(parts[0].trim(), { en: parts[1].trim(), es: parts[2].trim(), it: parts[3].trim() });
  }

  // Units inside dynamic texts (lower case, differ from the stand-alone labels above)
  const UNITS = {
    Schritte: { en: 'steps', es: 'pasos', it: 'passi' },
    Tage: { en: 'days', es: 'días', it: 'giorni' },
    Nächte: { en: 'nights', es: 'noches', it: 'notti' },
    Trainings: { en: 'workouts', es: 'entrenos', it: 'allenamenti' },
    'kg bewegt': { en: 'kg moved', es: 'kg movidos', it: 'kg sollevati' },
    Bestleistungen: { en: 'personal bests', es: 'marcas personales', it: 'record personali' },
    'Check-ins': { en: 'check-ins', es: 'check-ins', it: 'check-in' },
    'Tage in Folge': { en: 'days in a row', es: 'días seguidos', it: 'giorni di fila' },
  };
  const W = (de, en, es, it) => ({ de, en, es, it });
  const word = (lang, key) => (lang === 'de' ? key : (UNITS[key] || DICT.get(key) || {})[lang] || key);
  // (translate() is hoisted below and also handles patterns for longer parts)
  // Dynamic texts: [pattern, { en, es, it } as functions of the match]
  const PATTERNS = [
    [/^(\d+) von (\d+) eingetragen$/, W(0, (m) => `${m[1]} of ${m[2]} logged`, (m) => `${m[1]} de ${m[2]} registrados`, (m) => `${m[1]} di ${m[2]} registrati`)],
    [/^vor (\d+) Tagen$/, W(0, (m) => `${m[1]} days ago`, (m) => `hace ${m[1]} días`, (m) => `${m[1]} giorni fa`)],
    [/^(\d+) Tage in Folge eingetragen$/, W(0, (m) => `${m[1]} days logged in a row`, (m) => `${m[1]} días seguidos registrados`, (m) => `${m[1]} giorni di fila registrati`)],
    [/^Tag (\d+)$/, W(0, (m) => `Day ${m[1]}`, (m) => `Día ${m[1]}`, (m) => `Giorno ${m[1]}`)],
    [/^(\d+) Übungen$/, W(0, (m) => `${m[1]} exercises`, (m) => `${m[1]} ejercicios`, (m) => `${m[1]} esercizi`)],
    [/^Anleitung: (.+)$/, W(0, (m) => `How to: ${m[1]}`, (m) => `Cómo se hace: ${m[1]}`, (m) => `Come si fa: ${m[1]}`)],
    [/^Ziel ([^·]+)$/, W(0, (m) => `Target ${m[1]}`, (m) => `Objetivo ${m[1]}`, (m) => `Obiettivo ${m[1]}`)],
    [/^Ideal: (.+) Tage$/, W(0, (m) => `Ideal: ${m[1].replace('oder', 'or')} days`, (m) => `Ideal: ${m[1].replace('oder', 'o')} días`, (m) => `Ideale: ${m[1].replace('oder', 'o')} giorni`)],
    [/^Ein Split mit „Passt“ ist für (\d+) Trainingstage gedacht\. (.*)$/, W(0, (m) => `A split marked “Fits” is made for ${m[1]} training days. You get a standard plan with exercises, sets and reps.`, (m) => `Un split con “Encaja” está pensado para ${m[1]} días. Recibes un plan estándar con ejercicios, series y repeticiones.`, (m) => `Uno split con “Adatto” è pensato per ${m[1]} giorni. Ricevi un piano standard con esercizi, serie e ripetizioni.`)],
    [/^(.+?) Insgesamt ([\d.]+) Schritte gehen$/, null],
    [/^([\d.,]+(?: t)?) von ([\d.,]+(?: t)?) (.+)$/, W(0, (m, l) => `${m[1]} of ${m[2]} ${word(l, m[3])}`, (m, l) => `${m[1]} de ${m[2]} ${word(l, m[3])}`, (m, l) => `${m[1]} di ${m[2]} ${word(l, m[3])}`)],
    [/^✓ Erreicht am (.+)$/, W(0, (m) => `✓ Reached on ${m[1]}`, (m) => `✓ Logrado el ${m[1]}`, (m) => `✓ Raggiunto il ${m[1]}`)],
    [/^(\d+) Tage in Folge etwas eintragen$/, W(0, (m) => `Log something ${m[1]} days in a row`, (m) => `Registra algo ${m[1]} días seguidos`, (m) => `Registra qualcosa ${m[1]} giorni di fila`)],
    [/^Insgesamt ([\d.]+) Schritte gehen$/, W(0, (m) => `Walk ${m[1]} steps in total`, (m) => `Camina ${m[1]} pasos en total`, (m) => `Cammina ${m[1]} passi in totale`)],
    [/^An (\d+) Tagen dein Schrittziel \((.+)\) schaffen$/, W(0, (m) => `Hit your step goal (${m[2]}) on ${m[1]} days`, (m) => `Cumple tu objetivo de pasos (${m[2]}) ${m[1]} días`, (m) => `Raggiungi l'obiettivo passi (${m[2]}) per ${m[1]} giorni`)],
    [/^In (\d+) Nächten dein Schlafziel \((.+)\) erreichen$/, W(0, (m) => `Reach your sleep goal (${m[2]}) on ${m[1]} nights`, (m) => `Alcanza tu objetivo de sueño (${m[2]}) ${m[1]} noches`, (m) => `Raggiungi l'obiettivo di sonno (${m[2]}) per ${m[1]} notti`)],
    [/^An (\d+) Tagen dein Gewicht eintragen$/, W(0, (m) => `Log your weight on ${m[1]} days`, (m) => `Registra tu peso ${m[1]} días`, (m) => `Registra il peso per ${m[1]} giorni`)],
    [/^An (\d+) Tagen deine Kalorien einhalten$/, W(0, (m) => `Stay on your calories on ${m[1]} days`, (m) => `Cumple tus calorías ${m[1]} días`, (m) => `Rispetta le calorie per ${m[1]} giorni`)],
    [/^(\d+) Trainings absolvieren$/, W(0, (m) => `Complete ${m[1]} workouts`, (m) => `Completa ${m[1]} entrenos`, (m) => `Completa ${m[1]} allenamenti`)],
    [/^Insgesamt ([\d.,]+) Tonnen bewegen \(Gewicht × Wiederholungen\)$/, W(0, (m) => `Move ${m[1]} tonnes in total (weight × reps)`, (m) => `Mueve ${m[1]} toneladas en total (peso × reps)`, (m) => `Solleva ${m[1]} tonnellate in totale (peso × rip.)`)],
    [/^(\d+)× eine neue Bestleistung bei einer Übung aufstellen$/, W(0, (m) => `Set a new personal best ${m[1]} times`, (m) => `Logra una nueva marca personal ${m[1]} veces`, (m) => `Stabilisci un nuovo record ${m[1]} volte`)],
    [/^(\d+) Check-ins deines Coaches annehmen$/, W(0, (m) => `Accept ${m[1]} check-ins from your coach`, (m) => `Acepta ${m[1]} check-ins de tu coach`, (m) => `Accetta ${m[1]} check-in del coach`)],
    [/^Gerade (\d+) Tage? in Folge$/, W(0, (m) => `${m[1]} in a row right now`, (m) => `${m[1]} seguidos ahora mismo`, (m) => `${m[1]} di fila ora`)],
    [/^([\d.,]+(?: t)?) (Tage in Folge|Schritte|Tage|Nächte|Trainings|kg bewegt|Bestleistungen|Check-ins)( \(Rekord\))?$/, W(0, (m, l) => `${m[1]} ${word(l, m[2])}${m[3] ? ({ en: ' (record)', es: ' (récord)', it: ' (record)' })[l] : ''}`, (m, l) => `${m[1]} ${word(l, m[2])}${m[3] ? ' (récord)' : ''}`, (m, l) => `${m[1]} ${word(l, m[2])}${m[3] ? ' (record)' : ''}`)],
    [/^Noch (\d+) Medaillen?$/, W(0, (m) => `${m[1]} more medal${m[1] === '1' ? '' : 's'}`, (m) => `Faltan ${m[1]} medalla${m[1] === '1' ? '' : 's'}`, (m) => `Ancora ${m[1]} medagli${m[1] === '1' ? 'a' : 'e'}`)],
    [/^(\d+) verdient · (\d+) ausgegeben$/, W(0, (m) => `${m[1]} earned · ${m[2]} spent`, (m) => `${m[1]} ganadas · ${m[2]} gastadas`, (m) => `${m[1]} guadagnate · ${m[2]} spese`)],
    [/^(\d+) (Dosen?) · (\d+) (Medaillen?) übrig$/, W(0, (m) => `${m[1]} can${m[1] === '1' ? '' : 's'} · ${m[3]} medal${m[3] === '1' ? '' : 's'} left`, (m) => `${m[1]} lata${m[1] === '1' ? '' : 's'} · quedan ${m[3]} medalla${m[3] === '1' ? '' : 's'}`, (m) => `${m[1]} lattin${m[1] === '1' ? 'a' : 'e'} · ${m[3]} medagli${m[3] === '1' ? 'a' : 'e'} rimast${m[3] === '1' ? 'a' : 'e'}`)],
    [/^(Bronze|Silber|Gold): (.+) – (erreicht|(\d+) % geschafft)$/, null],
    [/^(\d+) (Gold|Silber|Bronze)$/, W(0, (m, l) => `${m[1]} ${word(l, m[2])}`, (m, l) => `${m[1]} ${word(l, m[2])}`, (m, l) => `${m[1]} ${word(l, m[2])}`)],
    [/^(.+) (Bronze|Silber|Gold)$/, W(0, (m, l) => `${word(l, m[1])} ${word(l, m[2])}`, (m, l) => `${word(l, m[1])} ${word(l, m[2])}`, (m, l) => `${word(l, m[1])} ${word(l, m[2])}`)],
    [/^noch ([\d.,]+(?: t)?) (.+)$/, W(0, (m, l) => `${m[1]} ${word(l, m[2])} to go`, (m, l) => `faltan ${m[1]} ${word(l, m[2])}`, (m, l) => `mancano ${m[1]} ${word(l, m[2])}`)],
    [/^(\d+) Tage pro Woche$/, W(0, (m) => `${m[1]} days per week`, (m) => `${m[1]} días por semana`, (m) => `${m[1]} giorni a settimana`)],
    [/^zuletzt ([^·]+)$/, W(0, (m, l) => `last ${word(l, m[1])}`, (m, l) => `último ${word(l, m[1])}`, (m, l) => `ultimo ${word(l, m[1])}`)],
    [/^letzter Eintrag (.+)$/, W(0, (m, l) => `last entry ${word(l, m[1])}`, (m, l) => `último registro ${word(l, m[1])}`, (m, l) => `ultima registrazione ${word(l, m[1])}`)],
    [/^in (\d+) Tagen$/, W(0, (m) => `in ${m[1]} days`, (m) => `en ${m[1]} días`, (m) => `in ${m[1]} giorni`)],
    [/^noch ([^·]+) bis ([^·]+)$/, W(0, (m) => `${m[1]} to go to ${m[2]}`, (m) => `faltan ${m[1]} hasta ${m[2]}`, (m) => `mancano ${m[1]} a ${m[2]}`)],
    [/^Ziel (.+) · (.+)$/, null],
  ];

  let lang = 'de';
  const origText = new WeakMap();
  const origAttr = new WeakMap();
  const ATTRS = ['placeholder', 'aria-label', 'title'];
  let busy = false;

  function translate(text) {
    if (lang === 'de') return text;
    const key = text.replace(/\s+/g, ' ').trim();
    if (!key || !/[A-Za-zÄÖÜäöüß]/.test(key)) return text;
    let out = DICT.has(key) ? DICT.get(key)[lang] : null;
    if (out === null) {
      for (const [re, fns] of PATTERNS) {
        if (!fns) continue;
        const m = key.match(re);
        if (m) {
          out = fns[lang](m, lang);
          break;
        }
      }
    }
    if ((out === null || out === undefined) && key.startsWith('· ')) {
      const rest = translate(key.slice(2));
      if (rest !== key.slice(2)) out = `· ${rest}`;
    }
    if ((out === null || out === undefined) && key.includes(' · ')) {
      // composed texts: translate each "·"-separated part on its own
      const parts = key.split(' · ').map((part) => translate(part));
      if (parts.join(' · ') !== key) out = parts.join(' · ');
    }
    if (out === null || out === undefined) return text;
    const lead = text.match(/^\s*/)[0];
    const trail = text.match(/\s*$/)[0];
    return lead + out + trail;
  }

  const skip = (el) => el && el.closest && el.closest('script, style, [data-no-i18n], textarea, .chat-log, [contenteditable]');

  function doText(node) {
    if (skip(node.parentElement)) return;
    if (!origText.has(node)) origText.set(node, node.nodeValue);
    const want = translate(origText.get(node));
    if (node.nodeValue !== want) node.nodeValue = want;
  }
  function doEl(el) {
    if (skip(el)) return;
    let o = origAttr.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      if (!o) { o = {}; origAttr.set(el, o); }
      if (!(a in o)) o[a] = el.getAttribute(a);
      const want = translate(o[a]);
      if (el.getAttribute(a) !== want) el.setAttribute(a, want);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    doEl(root);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = it.nextNode())) n.nodeType === 3 ? doText(n) : doEl(n);
  }
  let observer = null;
  function run(fn) {
    busy = true;
    try {
      fn();
    } finally {
      if (observer) observer.takeRecords(); // drop the mutations we just made ourselves
      busy = false;
    }
  }

  observer = new MutationObserver((list) => {
    if (busy) return;
    run(() => {
      for (const m of list) {
        if (m.type === 'characterData') {
          origText.set(m.target, m.target.nodeValue); // the app changed this text: it is the new original
          doText(m.target);
        } else if (m.type === 'attributes') {
          const o = origAttr.get(m.target);
          if (o) o[m.attributeName] = m.target.getAttribute(m.attributeName);
          doEl(m.target);
        } else {
          m.addedNodes.forEach(walk);
        }
      }
    });
  });

  function setLang(l) {
    lang = LANGS.includes(l) ? l : 'de';
    document.documentElement.lang = lang;
    run(() => walk(document.body));
  }

  function start() {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    if (lang !== 'de') run(() => walk(document.body));
  }

  window.I18N = {
    setLang,
    t: translate,
    get lang() { return lang; },
    get locale() { return LOCALES[lang]; },
  };
  try {
    const p = JSON.parse(localStorage.getItem('sot-prefs') || '{}');
    if (LANGS.includes(p.lang)) lang = p.lang;
  } catch { /* ignore */ }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
