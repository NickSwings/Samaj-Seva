# Samaj Seva — Smart Volunteer Coordination

Samaj Seva is a dynamic, multi-tenant platform designed to bridge the gap between NGOs and community volunteers. Built for the Google Solution Challenge 2026, it utilizes Google's Generative AI to ensure that the right volunteers are matched to the right tasks based on their specific skill sets, availability, and geographic location.

## 🚀 Key Features
* **Multi-User Architecture:** Dedicated authentication flows, specialized dashboards, and full CRUD capabilities for both Volunteers and Organizations.
* **AI-Powered Matching Engine:** Integrates `gemini-1.5-flash` to instantly analyze volunteer skill profiles against NGO task requirements, generating compatibility scores and actionable reasoning.
* **Smart UX/UI:** Features a 3-step dynamic registration wizard, an Omni-Search filter (search by task, skill, NGO, or location), native emoji-flag dropdowns, and dynamic availability matrix tables.
* **Real-Time Data Sync:** Utilizes Firebase Firestore `onSnapshot` listeners so task acceptance, status toggling, and roster updates happen instantly across all active dashboards without page reloads.
* **Resilient Infrastructure:** Implements a hybrid sorting strategy with a lightning-fast local mathematical fallback to prevent UI freezing during API rate-limiting.

## 🛠️ Tech Stack
* **Frontend:** Vanilla JavaScript, HTML5, Tailwind CSS
* **Backend & Auth:** Firebase Authentication, Firestore Database
* **AI Integration:** Google Generative Language API (Gemini 1.5 Flash)

## 🔮 Future Architecture & Scalability
For this MVP prototype, Samaj Seva relies on the cloud-based Gemini API. In our production roadmap, we plan to transition to Google's **Gemma** open-weights model. By deploying a lightweight version of Gemma on edge devices via MediaPipe or Vertex AI, we aim to provide fully offline, privacy-preserving volunteer matching capabilities for NGOs operating in remote areas with unstable internet connectivity.

## 👨‍💻 Core Team
* **Raunak Dey** – Lead Developer 
* **Priyanshu Dey** – Frontend Developer

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.