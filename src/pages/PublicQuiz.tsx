import PublicQuizRunner from './PublicQuizRunner';

/**
 * Página pública do Quiz — usa renderer dedicado em predeterminado inlead
 * (form-style, 1 tela por bloco), sin header de bot / balões.
 */
export default function PublicQuiz() {
  return <PublicQuizRunner />;
}
